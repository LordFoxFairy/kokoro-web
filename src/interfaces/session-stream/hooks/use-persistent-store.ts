import { useSyncExternalStore } from "react"

import {
  type ConversationStore,
  parseStoredConversationStore,
} from "@/application/conversation-store"

// 多会话持久化键：落地整个会话 store（列表 + 活跃项），刷新后据此恢复。
export const STORAGE_KEY = "kokoro:conversations"

// 持久化种子作为外部 store 读取：useSyncExternalStore 在 SSR 用 server 快照（null），
// 水合首帧与服务端一致（空首屏），随后切到客户端快照恢复——既无 hydration mismatch，
// 也无需在 effect 里 setState。快照必须按原始字符串缓存出稳定引用，否则 React 会判定
// 快照恒变而抛无限循环告警。
let cachedRaw: string | null = null
let cachedSeed: ConversationStore | null = null

function readPersistedStore(): ConversationStore | null {
  if (typeof window === "undefined") {
    return null
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)

  if (raw === cachedRaw) {
    return cachedSeed
  }

  cachedRaw = raw

  if (raw === null) {
    cachedSeed = null
    return null
  }

  try {
    cachedSeed = parseStoredConversationStore(JSON.parse(raw))
  } catch {
    // 损坏的 JSON 直接放过：种子降级为 null，停留在空首屏，绝不因脏数据崩溃。
    cachedSeed = null
  }

  return cachedSeed
}

function subscribePersistedStore(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  // 仅订阅跨标签页的 storage 事件；同标签页内的写入由 React 状态自身驱动。
  window.addEventListener("storage", onChange)
  return () => window.removeEventListener("storage", onChange)
}

// 持久化种子 hook：水合后才出现，作为会话 store 的初始值。
export function usePersistentStore(): ConversationStore | null {
  return useSyncExternalStore(
    subscribePersistedStore,
    readPersistedStore,
    () => null,
  )
}
