// 多会话列表索引纯操作：仅 UI 偏好与列表元数据（消息/run 权威在服务端 snapshot）。

import type { SessionMessage } from "./state"

// 回应模式：纯 UI 偏好（不上 wire；RuntimeConfig 档位由 session 解析）。
export type AgentMode = "fast" | "thinking"

export type ConversationEntry = {
  id: string
  // 空串表示尚无标题（占位文案由渲染层决定）。
  title: string
  updatedAt: number
  mode: AgentMode
}

export type ConversationStore = {
  activeId: string
  conversations: ConversationEntry[]
}

const TITLE_MAX = 24

// 标题回退派生：首条用户消息（截断）；session.created/snapshot 提供的服务端标题优先于它。
export function conversationTitle(messages: readonly SessionMessage[]): string {
  const firstUser = messages.find((message) => message.role === "user")
  const text = firstUser?.content.trim() ?? ""
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

function activeEntry(store: ConversationStore): ConversationEntry | undefined {
  return store.conversations.find((entry) => entry.id === store.activeId)
}

// 新建一个空会话并置为活跃（置于列表最前）。store 为 null 时即新建首个。
export function addConversation(
  store: ConversationStore | null,
  id: string,
  now: number,
  mode: AgentMode = "fast",
): ConversationStore {
  const entry: ConversationEntry = { id, title: "", updatedAt: now, mode }
  if (!store) {
    return { activeId: id, conversations: [entry] }
  }
  return { activeId: id, conversations: [entry, ...store.conversations] }
}

// 刷新活跃会话的标题与更新时间（事件折叠/水合后由引擎调用）。
export function touchActive(
  store: ConversationStore,
  title: string,
  now: number,
): ConversationStore {
  return {
    ...store,
    conversations: store.conversations.map((entry) =>
      entry.id === store.activeId ? { ...entry, title, updatedAt: now } : entry,
    ),
  }
}

// 设置活跃会话的回应模式（调用方负责在「已开聊即锁定」时不再调用）。
export function setActiveMode(store: ConversationStore, mode: AgentMode): ConversationStore {
  return {
    ...store,
    conversations: store.conversations.map((entry) =>
      entry.id === store.activeId ? { ...entry, mode } : entry,
    ),
  }
}

export function activeMode(store: ConversationStore): AgentMode {
  return activeEntry(store)?.mode ?? "fast"
}

export function selectConversation(store: ConversationStore, id: string): ConversationStore {
  const exists = store.conversations.some((entry) => entry.id === id)
  return exists ? { ...store, activeId: id } : store
}

// 删除一个会话；删空则用 fallbackId 起一个新的空会话；删的是活跃项则激活余下首个。
export function removeConversation(
  store: ConversationStore,
  id: string,
  fallbackId: string,
  now: number,
): ConversationStore {
  const remaining = store.conversations.filter((entry) => entry.id !== id)
  if (remaining.length === 0) {
    return addConversation(null, fallbackId, now)
  }
  const firstId = remaining[0]?.id ?? store.activeId
  const activeId = store.activeId === id ? firstId : store.activeId
  return { activeId, conversations: remaining }
}

// 列表展示用：按更新时间倒序（最近的在上）。
export function sortedConversations(store: ConversationStore): ConversationEntry[] {
  return [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}
