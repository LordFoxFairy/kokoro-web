// 全站唯一 localStorage 外部 store：Zod 参数化，raw 比对短路缓存 + storage 事件失效。

import type { z } from "zod"

export type PersistedStore<T> = {
  // 缓存稳定引用：raw 未变时返回同一对象（useSyncExternalStore 快照要求）。
  read: () => T | null
  write: (value: T) => void
  subscribe: (onChange: () => void) => () => void
}

export function createPersistedStore<T>(options: {
  key: string
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
  serialize?: (value: T) => unknown
}): PersistedStore<T> {
  const serialize = options.serialize ?? ((value: T): unknown => value)
  let cachedRaw: string | null = null
  let cachedValue: T | null = null
  const listeners = new Set<() => void>()
  let storageBound = false

  const emit = (): void => {
    for (const listener of listeners) {
      listener()
    }
  }

  const parseRaw = (raw: string | null): T | null => {
    if (raw === null) {
      return null
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      // 坏 JSON 降级为 null：停留在空态，不因脏数据崩溃。
      return null
    }
    const result = options.schema.safeParse(parsed)
    return result.success ? result.data : null
  }

  const read = (): T | null => {
    if (typeof window === "undefined") {
      return null
    }
    const raw = window.localStorage.getItem(options.key)
    if (raw === cachedRaw) {
      return cachedValue
    }
    cachedRaw = raw
    cachedValue = parseRaw(raw)
    return cachedValue
  }

  const write = (value: T): void => {
    cachedValue = value
    const raw = JSON.stringify(serialize(value))
    if (typeof window === "undefined") {
      cachedRaw = raw
    } else {
      try {
        window.localStorage.setItem(options.key, raw)
        cachedRaw = raw
      } catch {
        // 配额/隐私模式写入失败：cachedRaw 不更新，read 短路回内存态而非回读旧盘值。
      }
    }
    emit()
  }

  const onStorage = (event: StorageEvent): void => {
    // 只对本键（或 clear() 的 key=null）响应：另一标签页写入即失效缓存 + 通知重读。
    if (event.key !== null && event.key !== options.key) {
      return
    }
    cachedRaw = null
    cachedValue = null
    emit()
  }

  const subscribe = (onChange: () => void): (() => void) => {
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

  return { read, write, subscribe }
}
