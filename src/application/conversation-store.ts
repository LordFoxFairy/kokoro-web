import { z } from "zod"

import {
  createSessionStreamState,
  type SessionStreamState,
} from "./session-stream/reducer"
import {
  serializeSessionState,
  storedSessionStateSchema,
} from "./session-stream/state-schema"

// 多会话 store：左侧列表 + 当前活跃会话。所有操作为纯不可变函数，便于测试；
// 时间戳/新 id 由调用方在事件处理里传入（不在 render 里取，避免 SSR 抖动）。

// 回应模式：Fast（更快）/ Thinking（更深思考）。每个会话各自持有；首条消息后锁定，不可再切换。
export type AgentMode = "fast" | "thinking"

export type ConversationEntry = {
  id: string
  title: string
  updatedAt: number
  thread: SessionStreamState
  // 本会话选定的回应模式；一旦开聊（有消息）即锁定。
  mode: AgentMode
  // 在途 live run 的输入：刷新/断线后据此重连续传；run 落定即清除。
  pendingInput?: string
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

function emptyEntry(
  id: string,
  now: number,
  mode: AgentMode = "fast",
): ConversationEntry {
  return {
    id,
    title: NEW_CONVERSATION_TITLE,
    updatedAt: now,
    thread: createSessionStreamState(),
    mode,
  }
}

export function createConversationStore(
  id: string,
  now: number,
): ConversationStore {
  return { activeId: id, conversations: [emptyEntry(id, now)] }
}

function activeEntry(
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
// mode 为新会话的初始回应模式（首个会话承接空首屏上选好的模式）。
export function addConversation(
  store: ConversationStore | null,
  id: string,
  now: number,
  mode: AgentMode = "fast",
): ConversationStore {
  const entry = emptyEntry(id, now, mode)
  if (!store) {
    return { activeId: id, conversations: [entry] }
  }
  return { activeId: id, conversations: [entry, ...store.conversations] }
}

// 设置活跃会话的回应模式（调用方负责在「已开聊即锁定」时不再调用）。
export function setActiveMode(
  store: ConversationStore,
  mode: AgentMode,
): ConversationStore {
  return {
    ...store,
    conversations: store.conversations.map((entry) =>
      entry.id === store.activeId ? { ...entry, mode } : entry,
    ),
  }
}

// 活跃会话的回应模式（无会话时回退 fast）。
export function activeMode(store: ConversationStore): AgentMode {
  return activeEntry(store)?.mode ?? "fast"
}

// 活跃会话是否已锁定模式（已开聊：有消息即锁定，不可再切换）。
export function isActiveModeLocked(store: ConversationStore): boolean {
  return activeThreadOf(store).messages.length > 0
}

// 标记/清除活跃会话的在途 run（pendingInput）。clear 传 undefined。
export function setActivePending(
  store: ConversationStore,
  pendingInput: string | undefined,
): ConversationStore {
  return {
    ...store,
    conversations: store.conversations.map((entry) =>
      entry.id === store.activeId ? { ...entry, pendingInput } : entry,
    ),
  }
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
    // 旧版落盘无 mode：默认补 fast，保持向后兼容，不因新增字段判脏。
    mode: z.enum(["fast", "thinking"]).default("fast"),
    pendingInput: z.string().optional(),
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

// 落盘前把每个会话线程的 Set 还原成 string[]（见 serializeSessionState）。
export function serializeConversationStore(store: ConversationStore): unknown {
  return {
    ...store,
    conversations: store.conversations.map((entry) => ({
      ...entry,
      thread: serializeSessionState(entry.thread),
    })),
  }
}
