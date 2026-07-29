import type { SessionConnectionState } from "@kokoro/session-client"
import type {
  MessagePartEnvelope,
  MessageRecord,
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"

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
  readonly activeBranchId: string | null
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

const ACTIVE_RUN_STATUSES = new Set([
  "admission_pending",
  "waiting_prerequisite",
  "running",
  "paused",
  "cancelling",
  "outcome_unknown",
])
const ACTIVE_LAUNCH_STATUSES = new Set([
  "intent_recorded",
  "admission_pending",
  "waiting_prerequisite",
  "reserved",
  "committed",
  "dispatch_pending",
  "dispatched",
  "event_observed",
  "outcome_unknown",
])

export function createChatProjection(): ChatProjection {
  return {
    messages: [],
    activeBranchId: null,
    activeRunId: null,
    connection: { kind: "idle" },
    command: { state: "idle" },
    repair: { required: false },
  }
}

function messageStatus(lifecycle: MessageRecord["lifecycle"]): ChatProjectionMessage["status"] {
  if (lifecycle === "completed") return "complete"
  if (["partial", "failed", "canceled"].includes(lifecycle)) return "incomplete"
  return "running"
}

function toolStatus(part: Extract<MessagePartEnvelope, { kind: "tool-call" }>): Extract<ChatPart, { kind: "tool" }>["status"] {
  if (part.lifecycle === "failed" || part.lifecycle === "canceled") return "error"
  if (part.lifecycle === "partial") return "incomplete"
  if (part.lifecycle === "completed") return "complete"
  if (/await|approval/iu.test(part.payload.status)) return "awaiting"
  return "running"
}

function projectPart(part: MessagePartEnvelope): ChatPart {
  switch (part.kind) {
    case "text":
      return { kind: "text", id: part.part_id, text: part.payload.spans.map((span) => span.text).join("") }
    case "reasoning":
      return { kind: "reasoning", id: part.part_id, text: part.payload.safe_summary }
    case "tool-call":
      return {
        kind: "tool",
        id: part.part_id,
        name: part.payload.tool_label,
        args: part.payload.input_summary,
        status: toolStatus(part),
      }
    case "unsupported":
      return { kind: "unsupported", id: part.part_id, originalKind: part.payload.original_kind }
    default:
      return { kind: "unsupported", id: part.part_id, originalKind: part.kind }
  }
}

function projectMessage(message: MessageRecord): ChatProjectionMessage | null {
  if (message.role === "system") return null
  return {
    id: message.message_id,
    runId: message.run_id ?? null,
    role: message.role,
    createdAt: message.created_at,
    parts: [...message.parts].sort((left, right) => left.ordinal - right.ordinal).map(projectPart),
    status: messageStatus(message.lifecycle),
  }
}

function upsertMessage(
  messages: readonly ChatProjectionMessage[],
  message: ChatProjectionMessage,
): readonly ChatProjectionMessage[] {
  const index = messages.findIndex((candidate) => candidate.id === message.id)
  if (index < 0) return [...messages, message]
  const next = [...messages]
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

function activeMessageRecords(snapshot: SessionSnapshot): Readonly<{
  messages: readonly MessageRecord[]
  complete: boolean
}> {
  const leafId = snapshot.session.active_leaf_message_id
  if (leafId === undefined) {
    return {
      messages: snapshot.messages
        .filter((message) => message.branch_id === snapshot.session.active_branch_id)
        .sort((left, right) => left.ordinal - right.ordinal),
      complete: true,
    }
  }
  const byId = new Map(snapshot.messages.map((message) => [message.message_id, message]))
  const seen = new Set<string>()
  const reverse: MessageRecord[] = []
  let currentId: string | undefined = leafId
  while (currentId !== undefined) {
    if (seen.has(currentId)) return { messages: [], complete: false }
    seen.add(currentId)
    const message = byId.get(currentId)
    if (message === undefined) return { messages: [], complete: false }
    reverse.push(message)
    currentId = message.parent_message_id
  }
  return { messages: reverse.reverse(), complete: true }
}

function activeRunId(snapshot: SessionSnapshot): string | null {
  const candidates = snapshot.runs.filter((run) =>
    run.branch_id === snapshot.session.active_branch_id && ACTIVE_RUN_STATUSES.has(run.execution_status),
  )
  return candidates.at(-1)?.run_id ?? null
}

function reduceEvent(state: ChatProjection, event: SessionEvent): ChatProjection {
  switch (event.kind) {
    case "message.created": {
      if (event.payload.message.branch_id !== state.activeBranchId) return state
      const message = projectMessage(event.payload.message)
      return message === null ? state : { ...state, messages: upsertMessage(state.messages, message) }
    }
    case "message.part.updated": {
      const index = state.messages.findIndex((message) => message.id === event.payload.part.message_id)
      if (index < 0) {
        return { ...state, repair: { required: true, reason: "message_part_without_message" } }
      }
      const messages = [...state.messages]
      messages[index] = upsertPart(messages[index] as ChatProjectionMessage, projectPart(event.payload.part))
      return { ...state, messages }
    }
    case "run.launch.updated":
      return event.payload.launch.branch_id === state.activeBranchId &&
        ACTIVE_LAUNCH_STATUSES.has(event.payload.launch.status)
        ? { ...state, activeRunId: event.payload.launch.proposed_run_id }
        : state
    case "run.view.updated": {
      const run = event.payload.run
      if (run.branch_id !== state.activeBranchId) return state
      const active = ACTIVE_RUN_STATUSES.has(run.execution_status)
      const messages = state.messages.map((message) =>
        message.runId === run.run_id && !active
          ? { ...message, status: run.execution_status === "completed" ? "complete" as const : "incomplete" as const }
          : message,
      )
      return {
        ...state,
        messages,
        activeRunId: active ? run.run_id : state.activeRunId === run.run_id ? null : state.activeRunId,
      }
    }
    case "branch.activated":
      return {
        ...state,
        messages: [],
        activeBranchId: event.payload.branch_id,
        activeRunId: null,
        repair: { required: true, reason: "active_branch_changed_refetch_snapshot" },
      }
    case "session.updated":
      return event.payload.session.active_branch_id === state.activeBranchId
        ? state
        : {
            ...state,
            messages: [],
            activeBranchId: event.payload.session.active_branch_id,
            activeRunId: null,
            repair: { required: true, reason: "active_branch_changed_refetch_snapshot" },
          }
    case "branch.created":
    case "run.control.updated":
    case "run.cost.updated":
    case "command.receipt.updated":
      return state
  }
}

export function reduceChatProjection(state: ChatProjection, action: ChatProjectionAction): ChatProjection {
  switch (action.type) {
    case "snapshot": {
      const active = activeMessageRecords(action.snapshot)
      return {
        ...state,
        messages: active.messages.map(projectMessage).filter((message): message is ChatProjectionMessage => message !== null),
        activeBranchId: action.snapshot.session.active_branch_id,
        activeRunId: activeRunId(action.snapshot),
        repair: active.complete
          ? { required: false }
          : { required: true, reason: "snapshot_active_lineage_incomplete" },
      }
    }
    case "event":
      return reduceEvent(state, action.event)
    case "connection":
      return { ...state, connection: action.connection }
    case "command":
      return { ...state, command: { state: action.state, ...(action.detail ? { detail: action.detail } : {}) } }
    case "unsupported": {
      const existing = state.messages.find((message) => message.role === "assistant" && message.runId === action.runId)
      const message = existing ?? {
        id: `assistant:${action.runId}`,
        runId: action.runId,
        role: "assistant" as const,
        createdAt: new Date(0).toISOString(),
        parts: [],
        status: "running" as const,
      }
      return {
        ...state,
        messages: upsertMessage(state.messages, upsertPart(message, {
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
