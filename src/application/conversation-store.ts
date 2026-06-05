import { z } from "zod"

import {
  createSessionStreamState,
  storedSessionStateSchema,
  type SessionStreamState,
} from "./session-stream-reducer"

// 多会话 store：左侧列表 + 当前活跃会话。所有操作为纯不可变函数，便于测试；
// 时间戳/新 id 由调用方在事件处理里传入（不在 render 里取，避免 SSR 抖动）。

export type ConversationEntry = {
  id: string
  title: string
  updatedAt: number
  thread: SessionStreamState
}

export type ConversationStore = {
  activeId: string
  conversations: ConversationEntry[]
}

const NEW_CONVERSATION_TITLE = "新对话"
const TITLE_MAX = 24

// 标题取首条用户消息（截断）；尚无用户消息时用占位名。
export function conversationTitle(thread: SessionStreamState): string {
  const firstUser = thread.messages.find((message) => message.role === "user")
  const text = firstUser?.content.trim() ?? ""
  if (!text) {
    return NEW_CONVERSATION_TITLE
  }
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

function emptyEntry(id: string, now: number): ConversationEntry {
  return {
    id,
    title: NEW_CONVERSATION_TITLE,
    updatedAt: now,
    thread: createSessionStreamState(),
  }
}

export function createConversationStore(
  id: string,
  now: number,
): ConversationStore {
  return { activeId: id, conversations: [emptyEntry(id, now)] }
}

export function activeEntry(
  store: ConversationStore,
): ConversationEntry | undefined {
  return store.conversations.find((entry) => entry.id === store.activeId)
}

export function activeThreadOf(store: ConversationStore): SessionStreamState {
  return activeEntry(store)?.thread ?? createSessionStreamState()
}

// 把当前活跃会话的线程替换为 thread，并刷新其标题与更新时间。
export function withActiveThread(
  store: ConversationStore,
  thread: SessionStreamState,
  now: number,
): ConversationStore {
  return {
    ...store,
    conversations: store.conversations.map((entry) =>
      entry.id === store.activeId
        ? {
            ...entry,
            thread,
            title: conversationTitle(thread),
            updatedAt: now,
          }
        : entry,
    ),
  }
}

// 新建一个空会话并置为活跃（置于列表最前）。store 为 null 时即新建首个。
export function addConversation(
  store: ConversationStore | null,
  id: string,
  now: number,
): ConversationStore {
  const entry = emptyEntry(id, now)
  if (!store) {
    return { activeId: id, conversations: [entry] }
  }
  return { activeId: id, conversations: [entry, ...store.conversations] }
}

export function selectConversation(
  store: ConversationStore,
  id: string,
): ConversationStore {
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
export function sortedConversations(
  store: ConversationStore,
): ConversationEntry[] {
  return [...store.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
}

const storedEntrySchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    updatedAt: z.number(),
    thread: storedSessionStateSchema,
  })
  .strict()

const storedStoreSchema = z
  .object({
    activeId: z.string().min(1),
    conversations: z.array(storedEntrySchema),
  })
  .strict()

// 解析本地持久化的会话 store：严格校验，任何不合法都返回 null，让调用方降级到空首屏。
export function parseStoredConversationStore(
  raw: unknown,
): ConversationStore | null {
  const result = storedStoreSchema.safeParse(raw)
  return result.success ? result.data : null
}
