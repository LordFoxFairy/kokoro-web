import { z } from "zod"

import type {
  SessionStreamEvent,
  SessionTodo,
} from "@/domain/shared/session-stream-event"

export type SessionMessage = {
  id: string
  role: "assistant" | "user"
  content: string
}

export type SessionToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: "running" | "done"
}

export type SessionSubagent = {
  id: string
  name: string
  description: string
  subagentType: string
  source: "built-in" | "config-custom" | "runtime-custom"
  output?: string
  status: "running" | "done"
}

export type SegmentActivity = {
  messageId: string
  thinking: string
  toolCalls: SessionToolCall[]
  subagents: SessionSubagent[]
}

export type SessionStreamState = {
  seenEventIds: string[]
  messages: SessionMessage[]
  // 活动流：todo 仍按当前运行整表替换；思考/工具/子智能体改为按 assistant message 归桶。
  todos: SessionTodo[]
  activityByMessageId: Record<string, SegmentActivity>
  // 兼容当前 renderer（Task 4 再切）：始终镜像“最近被活动事件触达”的那一个 message bucket。
  toolCalls: SessionToolCall[]
  subagents: SessionSubagent[]
  thinking: string
  runStatus: "idle" | "completed" | "failed"
}

// 持久化校验属于应用层：它守的是本地落盘的 SessionStreamState，而非线上传输载荷。
// schema 必须与 SessionStreamState 形状逐字对齐——任何字段漂移都应在 typecheck 暴露。
const storedTodoSchema = z
  .object({
    content: z.string(),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict()

const storedToolCallSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    args: z.record(z.unknown()),
    result: z.string().optional(),
    status: z.enum(["running", "done"]),
  })
  .strict()

const storedSubagentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    subagentType: z.string().default("subagent"),
    source: z.enum(["built-in", "config-custom", "runtime-custom"]).default("built-in"),
    output: z.string().optional(),
    status: z.enum(["running", "done"]),
  })
  .strict()

const storedSegmentActivitySchema = z
  .object({
    messageId: z.string(),
    thinking: z.string().default(""),
    toolCalls: z.array(storedToolCallSchema).default([]),
    subagents: z.array(storedSubagentSchema).default([]),
  })
  .strict()

// 活动字段用 .default([]) / .default("")：旧版落盘（无这些字段）仍能解析并补默认值，
// 保持刷新可恢复的向后兼容，不因新增字段把历史会话判脏。
// 导出供 conversation-store 组合校验每个会话的线程。
export const storedSessionStateSchema = z
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
    todos: z.array(storedTodoSchema).default([]),
    activityByMessageId: z.record(storedSegmentActivitySchema).default({}),
    toolCalls: z.array(storedToolCallSchema).default([]),
    subagents: z.array(storedSubagentSchema).default([]),
    thinking: z.string().default(""),
    runStatus: z.enum(["idle", "completed", "failed"]),
  })
  // 输入为 unknown（解析任意落盘数据）、输出严格等于 SessionStreamState（漂移在此暴露）。
  .strict() satisfies z.ZodType<SessionStreamState, z.ZodTypeDef, unknown>

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
    todos: [],
    activityByMessageId: {},
    toolCalls: [],
    subagents: [],
    thinking: "",
    runStatus: "idle",
  }
}

function createEmptyActivity(messageId: string): SegmentActivity {
  return {
    messageId,
    thinking: "",
    toolCalls: [],
    subagents: [],
  }
}

function ensureActivity(
  state: SessionStreamState,
  messageId: string,
): SegmentActivity {
  return state.activityByMessageId[messageId] ?? createEmptyActivity(messageId)
}

function replaceActivity(
  state: SessionStreamState,
  activity: SegmentActivity,
): SessionStreamState {
  return {
    ...state,
    activityByMessageId: {
      ...state.activityByMessageId,
      [activity.messageId]: activity,
    },
    toolCalls: activity.toolCalls,
    subagents: activity.subagents,
    thinking: activity.thinking,
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

  let nextState: SessionStreamState = {
    ...state,
    seenEventIds: [...state.seenEventIds, event.eventId],
    messages: [...state.messages],
    activityByMessageId: { ...state.activityByMessageId },
    toolCalls: [...state.toolCalls],
    subagents: [...state.subagents],
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

  if (event.kind === "thinking-delta") {
    const activity = ensureActivity(nextState, event.messageId)
    nextState = replaceActivity(nextState, {
      ...activity,
      thinking: `${activity.thinking}${event.delta}`,
    })
  }

  if (event.kind === "tool-invoked") {
    const activity = ensureActivity(nextState, event.messageId)
    nextState = replaceActivity(nextState, {
      ...activity,
      toolCalls: [
        ...activity.toolCalls,
        {
          id: event.toolId,
          name: event.name,
          args: event.args,
          status: "running",
        },
      ],
    })
  }

  if (event.kind === "tool-returned") {
    const activity = ensureActivity(nextState, event.messageId)
    const index = activity.toolCalls.findIndex((t) => t.id === event.toolId)
    const existing = index >= 0 ? activity.toolCalls[index] : undefined
    const toolCalls = [...activity.toolCalls]
    if (existing) {
      toolCalls[index] = {
        ...existing,
        result: event.result,
        status: "done",
      }
    } else {
      // 无配对的 invoked（如部分 replay）：仍记录已完成的结果，不丢事件。
      toolCalls.push({
        id: event.toolId,
        name: event.name,
        args: {},
        result: event.result,
        status: "done",
      })
    }
    nextState = replaceActivity(nextState, {
      ...activity,
      toolCalls,
    })
  }

  if (event.kind === "todo-updated") {
    // 整表替换：todo.updated 每次携带完整清单，反映当前进度。
    nextState.todos = event.todos
  }

  if (event.kind === "subagent-started") {
    const activity = ensureActivity(nextState, event.messageId)
    nextState = replaceActivity(nextState, {
      ...activity,
      subagents: [
        ...activity.subagents,
        {
          id: event.subagentId,
          name: event.name,
          description: event.description,
          subagentType: event.subagentType,
          source: event.source,
          status: "running",
        },
      ],
    })
  }

  if (event.kind === "subagent-finished") {
    const activity = ensureActivity(nextState, event.messageId)
    const index = activity.subagents.findIndex((s) => s.id === event.subagentId)
    const existing = index >= 0 ? activity.subagents[index] : undefined
    if (existing) {
      const subagents = [...activity.subagents]
      subagents[index] = { ...existing, status: "done" }
      nextState = replaceActivity(nextState, {
        ...activity,
        subagents,
      })
    }
  }

  if (event.kind === "subagent-text-delta") {
    const activity = ensureActivity(nextState, event.messageId)
    const index = activity.subagents.findIndex((s) => s.id === event.subagentId)
    const existing = index >= 0 ? activity.subagents[index] : undefined
    if (existing) {
      const subagents = [...activity.subagents]
      subagents[index] = {
        ...existing,
        output: `${existing.output ?? ""}${event.text}`,
      }
      nextState = replaceActivity(nextState, {
        ...activity,
        subagents,
      })
    }
  }

  if (event.kind === "subagent-text-completed") {
    const activity = ensureActivity(nextState, event.messageId)
    const index = activity.subagents.findIndex((s) => s.id === event.subagentId)
    const existing = index >= 0 ? activity.subagents[index] : undefined
    if (existing) {
      const subagents = [...activity.subagents]
      subagents[index] = { ...existing, output: event.text }
      nextState = replaceActivity(nextState, {
        ...activity,
        subagents,
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
  // 新一轮从干净的活动开始：run-level 镜像状态（todo/工具/子智能体/思考）只反映当前轮，
  // 但历史 assistant message 的 message-scoped activity buckets 需要保留，供 thread/replay/render 继续使用。
  // 上一轮终态（completed/failed）也必须复位为 idle，避免新问题尚未开始时继续挂着旧终态。
  return {
    ...state,
    messages: [
      ...state.messages,
      { id: message.id, role: "user", content: message.content },
    ],
    todos: [],
    toolCalls: [],
    subagents: [],
    thinking: "",
    runStatus: "idle",
  }
}
