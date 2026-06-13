// 过程块展开意图的持久化（UI-only，不污染域 conversation-store）：用户手动展开/收起某段过程后，
// 刷新仍保留该意图。按全局唯一的 segmentId 键，只存 override（缺省跟随 live 信号），带容量上限防无界增长。

export const DISCLOSURE_KEY = "kokoro:process-disclosure"
export const DISCLOSURE_CAP = 500

type DisclosureMap = Record<string, boolean>

let cache: DisclosureMap | null = null
const listeners = new Set<() => void>()

function load(): DisclosureMap {
  if (cache) {
    return cache
  }
  if (typeof window === "undefined") {
    return {}
  }
  try {
    const raw = window.localStorage.getItem(DISCLOSURE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : {}
    cache =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as DisclosureMap)
        : {}
  } catch {
    // 损坏的 JSON 直接放过：降级为无 override，绝不因脏数据崩溃。
    cache = {}
  }
  return cache
}

function persist(map: DisclosureMap): void {
  cache = map
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(DISCLOSURE_KEY, JSON.stringify(map))
    } catch {
      // 配额/隐私模式写入失败：保留内存态，不崩。
    }
  }
  for (const listener of listeners) {
    listener()
  }
}

// 该段的手动 override：true=手动展开 / false=手动收起 / null=无 override（跟随 live）。
export function getDisclosure(segmentId: string): boolean | null {
  const value = load()[segmentId]
  return value === undefined ? null : value
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
  return () => {
    listeners.delete(onChange)
  }
}

export function __resetDisclosureCacheForTest(): void {
  cache = null
}
