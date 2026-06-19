// 过程块展开意图的持久化（UI-only，不污染域 conversation-store）：用户手动展开/收起某段过程后，
// 刷新仍保留该意图。按全局唯一的 segmentId 键，只存 override（缺省跟随 live 信号），带容量上限防无界增长。
// 跨标签页同步与读时回读对齐姊妹 use-persistent-store：raw 比对短路缓存 + storage 事件失效。

import { z } from "zod"

export const DISCLOSURE_KEY = "kokoro:process-disclosure"
export const DISCLOSURE_CAP = 500

type DisclosureMap = Record<string, boolean>

// cache 与它构建时的原始字符串：raw 一致才复用，否则回读 localStorage（跨标签页写入即被感知）。
let cacheRaw: string | null = null
let cache: DisclosureMap | null = null
const listeners = new Set<() => void>()
let storageBound = false

// 外层仅放行「键为 string 的普通对象」（数组/标量/null 整体退化为 {}）；值逐项过滤，语义等价于原
// `typeof value === "boolean"`（boolean 值留存、其余丢弃），并额外硬化字面量原型键（z.record 会剥离 __proto__）。
const recordSchema = z.record(z.string(), z.unknown())
const booleanValue = z.boolean()

// 解析持久化盘面：坏 JSON/非对象 → {}；**逐值只放行 boolean**（localStorage 是不可信外部边界，
// 篡改/旧格式注入的非布尔值不得泄漏成 aria-expanded / inert / CSS 的脏开关）。
function parse(raw: string | null): DisclosureMap {
  if (!raw) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  const record = recordSchema.safeParse(parsed)
  if (!record.success) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(record.data).filter(
      ([, value]) => booleanValue.safeParse(value).success,
    ),
  ) as DisclosureMap
}

function load(): DisclosureMap {
  if (typeof window === "undefined") {
    return {}
  }
  const raw = window.localStorage.getItem(DISCLOSURE_KEY)
  if (raw === cacheRaw && cache) {
    return cache
  }
  cacheRaw = raw
  cache = parse(raw)
  return cache
}

function persist(map: DisclosureMap): void {
  cache = map
  const raw = JSON.stringify(map)
  if (typeof window === "undefined") {
    cacheRaw = raw
  } else {
    try {
      window.localStorage.setItem(DISCLOSURE_KEY, raw)
      cacheRaw = raw
    } catch {
      // 配额/隐私模式写入失败：cacheRaw 不更新，使 load() 短路回内存态而非回读旧磁盘值。
    }
  }
  for (const listener of listeners) {
    listener()
  }
}

function onStorage(event: StorageEvent): void {
  // 只对本键（或 clear() 的 key=null）响应：另一标签页写入即失效缓存 + 通知本页重渲染。
  if (event.key !== null && event.key !== DISCLOSURE_KEY) {
    return
  }
  cacheRaw = null
  cache = null
  for (const listener of listeners) {
    listener()
  }
}

// 该段的手动 override：true=手动展开 / false=手动收起 / null=无 override（跟随 live）。
export function getDisclosure(segmentId: string): boolean | null {
  const value = load()[segmentId]
  return typeof value === "boolean" ? value : null
}

export function setDisclosure(segmentId: string, open: boolean): void {
  const map = { ...load() }
  // 删后重插：移到末尾标记「最近」，便于按插入序淘汰最旧的，封顶 localStorage 体积。
  delete map[segmentId]
  map[segmentId] = open
  const keys = Object.keys(map)
  if (keys.length > DISCLOSURE_CAP) {
    for (const stale of keys.slice(0, keys.length - DISCLOSURE_CAP)) {
      delete map[stale]
    }
  }
  persist(map)
}

export function subscribeDisclosure(onChange: () => void): () => void {
  listeners.add(onChange)
  if (!storageBound && typeof window !== "undefined") {
    window.addEventListener("storage", onStorage)
    storageBound = true
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && storageBound && typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage)
      storageBound = false
    }
  }
}

export function __resetDisclosureCacheForTest(): void {
  cache = null
  cacheRaw = null
}
