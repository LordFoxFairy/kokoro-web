import { z } from "zod"

import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"

export type SessionMessage = {
  id: string
  role: "assistant" | "user"
  content: string
}

export type SessionStreamState = {
  seenEventIds: string[]
  messages: SessionMessage[]
  runStatus: "idle" | "completed" | "failed"
}

// 持久化校验属于应用层：它守的是本地落盘的 SessionStreamState，而非线上传输载荷。
// schema 必须与 SessionStreamState 形状逐字对齐——任何字段漂移都应在 typecheck 暴露。
const storedSessionStateSchema = z
  .object({
    seenEventIds: z.array(z.string()),
    messages: z.array(
      z
        .object({
          id: z.string(),
          role: z.enum(["assistant", "user"]),
          content: z.string(),
        })
        .strict(),
    ),
    runStatus: z.enum(["idle", "completed", "failed"]),
  })
  .strict() satisfies z.ZodType<SessionStreamState>

// 解析本地持久化的会话快照：严格校验，任何不合法（多余字段/缺字段/枚举越界/类型错）
// 都返回 null 而非抛错，让调用方可以安全地降级到空首屏，绝不因脏数据崩溃。
export function parseStoredSessionState(
  raw: unknown,
): SessionStreamState | null {
  const result = storedSessionStateSchema.safeParse(raw)

  return result.success ? result.data : null
}

export function createSessionStreamState(): SessionStreamState {
  return {
    seenEventIds: [],
    messages: [],
    runStatus: "idle",
  }
}

export function applySessionEvent(
  state: SessionStreamState,
  event: SessionStreamEvent,
): SessionStreamState {
  // 先按 eventId 去重，保证 replay / resume 的幂等收敛。
  if (state.seenEventIds.includes(event.eventId)) {
    return state
  }

  const nextState: SessionStreamState = {
    ...state,
    seenEventIds: [...state.seenEventIds, event.eventId],
    messages: [...state.messages],
  }

  if (event.kind === "session-created") {
    // 仅记录 eventId 用于去重，关闭重复 session-created 被重放的隐患。
    // 会话元数据（title/ownerId 等）当前不属于 SessionStreamState 的范围。
    return nextState
  }

  if (event.kind === "message-delta") {
    const index = nextState.messages.findIndex(
      (message) => message.id === event.messageId,
    )

    if (index >= 0) {
      const existing = nextState.messages[index]

      // role 在 messageId 首个增量时确定一次：后续增量只追加正文，
      // 即使传输误报了不同 role 也不会把内容串进错误气泡。
      nextState.messages[index] = {
        ...existing,
        content: `${existing?.content ?? ""}${event.delta}`,
      }
    } else {
      nextState.messages.push({
        id: event.messageId,
        role: event.role,
        content: event.delta,
      })
    }
  }

  if (event.kind === "message-completed") {
    const index = nextState.messages.findIndex(
      (message) => message.id === event.messageId,
    )

    // completed 事件必须覆盖增量正文，避免 replay 后残留半句内容。
    if (index >= 0) {
      nextState.messages[index] = {
        id: event.messageId,
        role: event.role,
        content: event.content,
      }
    } else {
      nextState.messages.push({
        id: event.messageId,
        role: event.role,
        content: event.content,
      })
    }
  }

  if (event.kind === "run-completed") {
    nextState.runStatus = "completed"
  }

  if (event.kind === "run-failed") {
    nextState.runStatus = "failed"
  }

  return nextState
}

// 协议只流式 assistant 消息；用户自己的输入是本地产生的，永不会被服务端 replay，
// 因此不进入 seenEventIds 去重表，只作为一条用户气泡追加进持久会话线。
export function appendUserMessage(
  state: SessionStreamState,
  message: { id: string; content: string },
): SessionStreamState {
  return {
    ...state,
    messages: [
      ...state.messages,
      { id: message.id, role: "user", content: message.content },
    ],
  }
}
