import type { SessionEvent, SessionSnapshot } from "@kokoro/session-client/contracts"
import type { SessionConnectionState } from "@kokoro/session-client"

export type ChatPart =
  | { readonly kind: "text"; readonly id: string; readonly text: string }
  | { readonly kind: "reasoning"; readonly id: string; readonly text: string }
  | {
      readonly kind: "tool"
      readonly id: string
      readonly name: string
      readonly args: Record<string, unknown>
      readonly result?: string
      readonly status: "running" | "awaiting" | "complete" | "error" | "incomplete"
    }
  | { readonly kind: "unsupported"; readonly id: string; readonly originalKind: string }

export type ChatProjectionMessage = {
  readonly id: string
  readonly runId: string | null
  readonly role: "user" | "assistant"
  readonly createdAt: string
  readonly parts: readonly ChatPart[]
  readonly status: "running" | "complete" | "incomplete"
}

export type ChatProjection = {
  readonly messages: readonly ChatProjectionMessage[]
  readonly activeRunId: string | null
  readonly connection: SessionConnectionState | { readonly kind: "idle" }
  readonly command: {
    readonly state: "idle" | "pending" | "conflict" | "failed"
    readonly detail?: string
  }
  readonly repair: { readonly required: boolean; readonly reason?: string }
}

export type ChatProjectionAction =
  | { readonly type: "snapshot"; readonly snapshot: SessionSnapshot }
  | { readonly type: "event"; readonly event: SessionEvent }
  | { readonly type: "connection"; readonly connection: SessionConnectionState }
  | {
      readonly type: "command"
      readonly state: ChatProjection["command"]["state"]
      readonly detail?: string
    }
  | { readonly type: "unsupported"; readonly runId: string; readonly originalKind: string }

export function createChatProjection(): ChatProjection {
  return {
    messages: [],
    activeRunId: null,
    connection: { kind: "idle" },
    command: { state: "idle" },
    repair: { required: false },
  }
}

function assistantMessage(state: ChatProjection, runId: string, timestamp: string): ChatProjectionMessage {
  return state.messages.find((message) => message.role === "assistant" && message.runId === runId) ?? {
    id: `assistant:${runId}`,
    runId,
    role: "assistant",
    createdAt: timestamp,
    parts: [],
    status: "running",
  }
}

function upsertMessage(state: ChatProjection, message: ChatProjectionMessage): readonly ChatProjectionMessage[] {
  const index = state.messages.findIndex((candidate) => candidate.id === message.id)
  if (index < 0) return [...state.messages, message]
  const next = [...state.messages]
  next[index] = message
  return next
}

function upsertPart(message: ChatProjectionMessage, part: ChatPart): ChatProjectionMessage {
  const index = message.parts.findIndex((candidate) => candidate.id === part.id)
  if (index < 0) return { ...message, parts: [...message.parts, part] }
  const next = [...message.parts]
  next[index] = part
  return { ...message, parts: next }
}

function appendPartText(message: ChatProjectionMessage, part: ChatPart & { text: string }): ChatProjectionMessage {
  const existing = message.parts.find((candidate) => candidate.id === part.id)
  return upsertPart(
    message,
    existing && (existing.kind === "text" || existing.kind === "reasoning")
      ? { ...part, text: `${existing.text}${part.text}` }
      : part,
  )
}

function reduceEvent(state: ChatProjection, event: SessionEvent): ChatProjection {
  if (event.kind === "message.user") {
    return {
      ...state,
      messages: upsertMessage(state, {
        id: event.payload.message_id,
        runId: event.run_id,
        role: "user",
        createdAt: event.timestamp,
        parts: [{ kind: "text", id: `${event.payload.message_id}:text`, text: event.payload.content }],
        status: "complete",
      }),
    }
  }
  let message = assistantMessage(state, event.run_id, event.timestamp)
  switch (event.kind) {
    case "run.created":
      return { ...state, activeRunId: event.payload.run_id }
    case "message.delta":
      message = appendPartText(message, { kind: "text", id: event.payload.segment_id, text: event.payload.delta })
      break
    case "message.completed":
      message = upsertPart(message, { kind: "text", id: event.payload.segment_id, text: event.payload.content })
      break
    case "thinking.delta":
      message = appendPartText(message, { kind: "reasoning", id: event.payload.segment_id, text: event.payload.delta })
      break
    case "tool.invoked":
      message = upsertPart(message, { kind: "tool", id: event.payload.tool_id, name: event.payload.name, args: event.payload.args, status: "running" })
      break
    case "tool.awaiting_approval":
      message = upsertPart(message, { kind: "tool", id: event.payload.tool_id, name: event.payload.name, args: event.payload.args, status: "awaiting" })
      break
    case "tool.returned":
      {
        const invoked = message.parts.find(
          (part): part is Extract<ChatPart, { readonly kind: "tool" }> =>
            part.kind === "tool" && part.id === event.payload.tool_id,
        )
        message = upsertPart(message, {
          kind: "tool",
          id: event.payload.tool_id,
          name: invoked?.name ?? event.payload.name,
          args: invoked?.args ?? {},
          result: event.payload.result,
          status: event.payload.is_error ? "error" : "complete",
        })
      }
      break
    case "run.completed":
      message = { ...message, status: event.payload.status === "cancelled" ? "incomplete" : "complete" }
      return { ...state, activeRunId: state.activeRunId === event.run_id ? null : state.activeRunId, messages: upsertMessage(state, message) }
    case "run.failed":
      message = { ...message, status: "incomplete" }
      return { ...state, activeRunId: state.activeRunId === event.run_id ? null : state.activeRunId, messages: upsertMessage(state, message) }
    case "session.created":
    case "tool.output.delta":
    case "todo.updated":
    case "delivery.created":
    case "subagent.started":
    case "subagent.finished":
    case "subagent.thinking.delta":
    case "subagent.text.delta":
    case "subagent.text.completed":
    case "subagent.tool.invoked":
    case "subagent.tool.returned":
      return state
  }
  return { ...state, messages: upsertMessage(state, message) }
}

export function reduceChatProjection(state: ChatProjection, action: ChatProjectionAction): ChatProjection {
  switch (action.type) {
    case "snapshot":
      return {
        ...state,
        messages: (action.snapshot.messages ?? []).map((message) => ({
          id: message.message_id,
          runId: message.run_id ?? null,
          role: message.role,
          createdAt: message.created_at,
          parts: [{ kind: "text", id: `${message.message_id}:legacy-text`, text: message.content }],
          status: message.status === "completed" ? "complete" : message.status === "failed" ? "incomplete" : "running",
        })),
        activeRunId: action.snapshot.active_run?.run_id ?? null,
        repair: { required: true, reason: "legacy_flat_snapshot" },
      }
    case "event":
      return reduceEvent(state, action.event)
    case "connection":
      return { ...state, connection: action.connection }
    case "command":
      return { ...state, command: { state: action.state, ...(action.detail ? { detail: action.detail } : {}) } }
    case "unsupported": {
      const message = assistantMessage(state, action.runId, new Date(0).toISOString())
      return {
        ...state,
        messages: upsertMessage(state, upsertPart(message, {
          kind: "unsupported",
          id: `unsupported:${action.originalKind}:${message.parts.length}`,
          originalKind: action.originalKind,
        })),
      }
    }
  }
}

export type ChatProjectionStore = {
  readonly getSnapshot: () => ChatProjection
  readonly subscribe: (listener: () => void) => () => void
  readonly dispatch: (action: ChatProjectionAction) => void
}

export function createChatProjectionStore(initial = createChatProjection()): ChatProjectionStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch(action) {
      const next = reduceChatProjection(state, action)
      if (next === state) return
      state = next
      for (const listener of listeners) listener()
    },
  }
}
