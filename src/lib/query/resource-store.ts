// 模块级 server-state 缓存：按 string key 存一份 {data,error,loading} 快照，跨组件共享。
// 窄约定（吸收「统一服务态契约」思想，规模不引 react-query；留后评估注记）：
//   ① 缓存：数据随 key 留存，跨挂载不闪空（重开面板即刻见旧值，再后台刷新）。
//   ② in-flight 去重：同 key 并发挂载/触发只发一次真实请求，结果广播给全部订阅者。
//   ③ invalidate(keyPrefix)：前缀失活——有订阅者立即重取，无订阅者丢缓存下次挂载再取。
//   ④ 竞态先发后至丢弃：全局自增序号，仅最新一发的结果落地，旧发即使后到也丢弃。
// 快照对象引用仅在内容变化时替换，供 useSyncExternalStore 稳定比对。

export type ResourceSnapshot<T> = {
  readonly data: T | undefined
  readonly error: unknown
  readonly loading: boolean
}

type Fetcher = () => Promise<unknown>

type Entry = {
  snapshot: ResourceSnapshot<unknown>
  activeSeq: number // 最近一发 fetch 的序号；结果落地前比对，旧发丢弃（先发后至丢弃）。
  inflight: boolean // 是否有请求在飞：并发挂载据此去重（在飞则共享，不重发）。
  fetcher: Fetcher | null // 最近注册的取数器，供 invalidate/refetch 复用。
  listeners: Set<() => void>
}

// 首挂载/SSR 的稳定 loading 快照（引用恒定，避免 useSyncExternalStore 抖动）。
const LOADING: ResourceSnapshot<unknown> = { data: undefined, error: undefined, loading: true }

const entries = new Map<string, Entry>()
let seqCounter = 0

function ensure(key: string): Entry {
  let entry = entries.get(key)
  if (entry === undefined) {
    entry = { snapshot: LOADING, activeSeq: 0, inflight: false, fetcher: null, listeners: new Set() }
    entries.set(key, entry)
  }
  return entry
}

function emit(entry: Entry): void {
  for (const listener of entry.listeners) {
    listener()
  }
}

function startFetch(entry: Entry): void {
  const fetcher = entry.fetcher
  if (fetcher === null) {
    return
  }
  const seq = ++seqCounter
  entry.activeSeq = seq
  entry.inflight = true
  // 保留已有 data（stale-while-revalidate），仅翻起 loading——重开不闪空。
  entry.snapshot = { data: entry.snapshot.data, error: undefined, loading: true }
  emit(entry)
  void fetcher().then(
    (data) => {
      if (entry.activeSeq !== seq) {
        return // 先发后至丢弃：已有更新的一发接管。
      }
      entry.inflight = false
      entry.snapshot = { data, error: undefined, loading: false }
      emit(entry)
    },
    (error: unknown) => {
      if (entry.activeSeq !== seq) {
        return
      }
      entry.inflight = false
      entry.snapshot = { data: undefined, error, loading: false }
      emit(entry)
    },
  )
}

// 订阅 key 并按需触发取数：挂载即后台刷新（in-flight 则去重共享）。返回退订。
export function subscribeResource(key: string, fetcher: Fetcher, onChange: () => void): () => void {
  const entry = ensure(key)
  entry.fetcher = fetcher
  entry.listeners.add(onChange)
  if (!entry.inflight) {
    startFetch(entry)
  }
  return () => {
    entry.listeners.delete(onChange)
  }
}

export function getResourceSnapshot<T>(key: string): ResourceSnapshot<T> {
  const entry = entries.get(key)
  return (entry?.snapshot ?? LOADING) as ResourceSnapshot<T>
}

export function serverResourceSnapshot<T>(): ResourceSnapshot<T> {
  return LOADING as ResourceSnapshot<T>
}

// 手动重取（重试/提交后对账）：无条件发起一发（先发后至丢弃兜底旧的在飞）。
export function refetchResource(key: string, fetcher: Fetcher): void {
  const entry = ensure(key)
  entry.fetcher = fetcher
  startFetch(entry)
}

// 前缀失活：有订阅者的 key 立即重取，无订阅者的丢缓存（下次挂载再取新值）。
export function invalidate(keyPrefix: string): void {
  for (const [key, entry] of entries) {
    if (!key.startsWith(keyPrefix)) {
      continue
    }
    if (entry.listeners.size > 0 && entry.fetcher !== null) {
      startFetch(entry)
    } else {
      entries.delete(key)
    }
  }
}

// test-only：清空模块级缓存，隔离用例。
export function __resetResourceStore(): void {
  entries.clear()
  seqCounter = 0
}
