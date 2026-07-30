import type { SessionConnectionState } from "@kokoro/session-client"
import type {
  MessagePartEnvelope,
  MessageRecord,
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"

type ChatPartBase = {
  readonly id: string
  readonly ordinal: number
  readonly version: number
  readonly lifecycle: MessagePartEnvelope["lifecycle"]
}

export type ChatPart = ChatPartBase & (
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reasoning"; readonly text: string }
  | {
      readonly kind: "citation"
      readonly sourceRef: string
      readonly title: string
      readonly locator?: string
      readonly attribution?: string
    }
  | {
      readonly kind: "tool"
      readonly name: string
      readonly args: Record<string, unknown>
      readonly result?: string
      readonly status: "running" | "awaiting" | "complete" | "error" | "incomplete"
      readonly effectRef?: string
      readonly receiptRef?: string
    }
  | {
      readonly kind: "approval" | "interaction"
      readonly ownerRef: string
      readonly expectedVersion: number
      readonly decisionGroupRef: string
      readonly requiredOwnerRefs: readonly string[]
      readonly title: string
      readonly description: string
      readonly riskSummary?: string
      readonly safeRequestSummary?: Readonly<Record<string, unknown>>
      readonly inputSchemaRef?: string
      readonly safeInputSchema?: Readonly<Record<string, unknown>>
      readonly deadline?: string
      readonly allowedActions: readonly string[]
      readonly receiptRef?: string
      readonly status: string
    }
  | {
      readonly kind: "plan"
      readonly planProposalRef: string
      readonly planVersion: number
      readonly summary: string
      readonly steps: readonly { readonly stepRef: string; readonly label: string; readonly status: string }[]
      readonly allowedActions: readonly string[]
      readonly deadline?: string
      readonly receiptRef?: string
      readonly status: string
    }
  | {
      readonly kind: "job" | "artifact"
      readonly ownerRef: string
      readonly status: string
      readonly safeMetadata: Readonly<Record<string, unknown>>
    }
  | {
      readonly kind: "cost"
      readonly costProjectionRef: string
      readonly status: string
      readonly amount?: string
      readonly currencyOrCreditUnit?: string
      readonly freshness: string
    }
  | {
      readonly kind: "notice" | "error"
      readonly code: string
      readonly message: string
      readonly retryClass: string
      readonly supportCorrelationRef?: string
    }
  | { readonly kind: "unsupported"; readonly originalKind: string }
)

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
  readonly activeRunState: "launching" | "running" | "paused" | "cancelling" | "outcome_unknown" | null
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
  | { readonly type: "repair"; readonly reason: string }
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
    activeRunState: null,
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
  const base = {
    id: part.part_id,
    ordinal: part.ordinal,
    version: part.version,
    lifecycle: part.lifecycle,
  }
  switch (part.kind) {
    case "text":
      return { ...base, kind: "text", text: part.payload.spans.map((span) => span.text).join("") }
    case "reasoning":
      return { ...base, kind: "reasoning", text: part.payload.safe_summary }
    case "citation":
      return {
        ...base,
        kind: "citation",
        sourceRef: part.payload.source_ref,
        title: part.payload.title,
        ...(part.payload.locator === undefined ? {} : { locator: part.payload.locator }),
        ...(part.payload.attribution === undefined ? {} : { attribution: part.payload.attribution }),
      }
    case "tool-call":
      return {
        ...base,
        kind: "tool",
        name: part.payload.tool_label,
        args: part.payload.input_summary,
        status: toolStatus(part),
        ...(part.payload.effect_ref === undefined ? {} : { effectRef: part.payload.effect_ref }),
        ...(part.payload.receipt_ref === undefined ? {} : { receiptRef: part.payload.receipt_ref }),
      }
    case "approval":
    case "interaction":
      return {
        ...base,
        kind: part.kind,
        ownerRef: part.payload.owner_ref,
        expectedVersion: part.payload.expected_version,
        decisionGroupRef: part.payload.decision_group_ref,
        requiredOwnerRefs: part.payload.required_owner_refs,
        title: part.payload.title,
        description: part.payload.description,
        allowedActions: part.payload.allowed_actions,
        status: part.payload.status,
        ...(part.payload.risk_summary === undefined ? {} : { riskSummary: part.payload.risk_summary }),
        ...(part.payload.safe_request_summary === undefined ? {} : { safeRequestSummary: part.payload.safe_request_summary }),
        ...(part.payload.input_schema_ref === undefined ? {} : { inputSchemaRef: part.payload.input_schema_ref }),
        ...(part.payload.safe_input_schema === undefined ? {} : { safeInputSchema: part.payload.safe_input_schema }),
        ...(part.payload.deadline === undefined ? {} : { deadline: part.payload.deadline }),
        ...(part.payload.receipt_ref === undefined ? {} : { receiptRef: part.payload.receipt_ref }),
      }
    case "plan":
      return {
        ...base,
        kind: "plan",
        planProposalRef: part.payload.plan_proposal_ref,
        planVersion: part.payload.plan_version,
        summary: part.payload.summary,
        steps: part.payload.steps.map((step) => ({ stepRef: step.step_ref, label: step.label, status: step.status })),
        allowedActions: part.payload.allowed_actions,
        status: part.payload.status,
        ...(part.payload.deadline === undefined ? {} : { deadline: part.payload.deadline }),
        ...(part.payload.receipt_ref === undefined ? {} : { receiptRef: part.payload.receipt_ref }),
      }
    case "job":
    case "artifact":
      return {
        ...base,
        kind: part.kind,
        ownerRef: part.payload.owner_ref,
        status: part.payload.status,
        safeMetadata: part.payload.safe_metadata,
      }
    case "cost":
      return {
        ...base,
        kind: "cost",
        costProjectionRef: part.payload.cost_projection_ref,
        status: part.payload.status,
        freshness: part.payload.freshness,
        ...(part.payload.amount === undefined ? {} : { amount: part.payload.amount }),
        ...(part.payload.currency_or_credit_unit === undefined ? {} : { currencyOrCreditUnit: part.payload.currency_or_credit_unit }),
      }
    case "notice":
    case "error":
      return {
        ...base,
        kind: part.kind,
        code: part.payload.code,
        message: part.payload.message,
        retryClass: part.payload.retry_class,
        ...(part.payload.support_correlation_ref === undefined ? {} : { supportCorrelationRef: part.payload.support_correlation_ref }),
      }
    case "unsupported":
      return { ...base, kind: "unsupported", originalKind: part.payload.original_kind }
  }
}

function sortParts(parts: readonly ChatPart[]): readonly ChatPart[] {
  return [...parts].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
}

function projectMessage(message: MessageRecord): ChatProjectionMessage | null {
  if (message.role === "system") return null
  return {
    id: message.message_id,
    runId: message.run_id ?? null,
    role: message.role,
    createdAt: message.created_at,
    parts: sortParts(message.parts.map(projectPart)),
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

function upsertPart(
  message: ChatProjectionMessage,
  part: ChatPart,
): {
  readonly message: ChatProjectionMessage
  readonly conflict?:
    | "part_identity_conflict"
    | "part_version_regression"
    | "part_version_conflict"
    | "part_version_gap"
} {
  const index = message.parts.findIndex((candidate) => candidate.id === part.id)
  if (index < 0) {
    return part.version === 1
      ? { message: { ...message, parts: sortParts([...message.parts, part]) } }
      : { message, conflict: "part_version_gap" }
  }
  const current = message.parts[index] as ChatPart
  if (part.ordinal !== current.ordinal || part.kind !== current.kind) {
    return { message, conflict: "part_identity_conflict" }
  }
  if (part.version < current.version) return { message, conflict: "part_version_regression" }
  if (part.version === current.version) {
    return JSON.stringify(part) === JSON.stringify(current)
      ? { message }
      : { message, conflict: "part_version_conflict" }
  }
  if (part.version !== current.version + 1) return { message, conflict: "part_version_gap" }
  const next = [...message.parts]
  next[index] = part
  return { message: { ...message, parts: sortParts(next) } }
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

function activeRun(snapshot: SessionSnapshot): Pick<ChatProjection, "activeRunId" | "activeRunState"> {
  const candidates = snapshot.runs.filter((run) =>
    run.branch_id === snapshot.session.active_branch_id && ACTIVE_RUN_STATUSES.has(run.execution_status),
  )
  const run = candidates.at(-1)
  const launch = snapshot.run_launches
    .filter((candidate) => candidate.branch_id === snapshot.session.active_branch_id && ACTIVE_LAUNCH_STATUSES.has(candidate.status))
    .at(-1)
  const runId = run?.run_id ?? launch?.proposed_run_id ?? null
  if (runId === null) return { activeRunId: null, activeRunState: null }
  const cancelling = snapshot.controls.some((control) =>
    control.run_id === runId && control.kind === "cancel" && ["pending", "persisted", "applied", "outcome_unknown"].includes(control.status),
  )
  if (cancelling) return { activeRunId: runId, activeRunState: "cancelling" }
  if (run?.execution_status === "paused") return { activeRunId: runId, activeRunState: "paused" }
  if (run?.execution_status === "outcome_unknown" || launch?.status === "outcome_unknown") {
    return { activeRunId: runId, activeRunState: "outcome_unknown" }
  }
  return { activeRunId: runId, activeRunState: run === undefined ? "launching" : "running" }
}

function reduceEvent(state: ChatProjection, event: SessionEvent): ChatProjection {
  switch (event.kind) {
    case "message.created": {
      if (event.payload.message.branch_id !== state.activeBranchId) return state
      const message = projectMessage(event.payload.message)
      return message === null ? state : { ...state, messages: upsertMessage(state.messages, message) }
    }
    case "message.part.updated": {
      const part = event.payload.part
      const owner = state.messages.find((message) => message.parts.some((candidate) => candidate.id === part.part_id))
      if (owner !== undefined && owner.id !== part.message_id) {
        return { ...state, repair: { required: true, reason: "part_identity_conflict" } }
      }
      const index = state.messages.findIndex((message) => message.id === part.message_id)
      if (index < 0) {
        return { ...state, repair: { required: true, reason: "message_part_without_message" } }
      }
      const currentMessage = state.messages[index] as ChatProjectionMessage
      const result = upsertPart(currentMessage, projectPart(part))
      if (result.conflict !== undefined) {
        return { ...state, repair: { required: true, reason: result.conflict } }
      }
      if (result.message === currentMessage) return state
      const messages = [...state.messages]
      messages[index] = result.message
      return { ...state, messages }
    }
    case "run.launch.updated": {
      const launch = event.payload.launch
      if (launch.branch_id !== state.activeBranchId) return state
      if (ACTIVE_LAUNCH_STATUSES.has(launch.status)) {
        return {
          ...state,
          activeRunId: launch.proposed_run_id,
          activeRunState: launch.status === "outcome_unknown" ? "outcome_unknown" : "launching",
        }
      }
      return state.activeRunId === launch.proposed_run_id
        ? { ...state, activeRunId: null, activeRunState: null }
        : state
    }
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
        activeRunState: active
          ? run.execution_status === "paused" || run.execution_status === "cancelling" || run.execution_status === "outcome_unknown"
            ? run.execution_status
            : "running"
          : state.activeRunId === run.run_id ? null : state.activeRunState,
      }
    }
    case "run.control.updated": {
      const control = event.payload.control
      if (control.run_id !== state.activeRunId || control.kind !== "cancel") return state
      if (["pending", "persisted", "applied", "outcome_unknown"].includes(control.status)) {
        return { ...state, activeRunState: control.status === "outcome_unknown" ? "outcome_unknown" : "cancelling" }
      }
      return control.status === "failed" ? { ...state, activeRunState: "running" } : state
    }
    case "branch.activated":
      return {
        ...state,
        messages: [],
        activeBranchId: event.payload.branch_id,
        activeRunId: null,
        activeRunState: null,
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
            activeRunState: null,
            repair: { required: true, reason: "active_branch_changed_refetch_snapshot" },
          }
    case "branch.created":
    case "run.cost.updated":
    case "command.receipt.updated":
      return state
  }
}

export function reduceChatProjection(state: ChatProjection, action: ChatProjectionAction): ChatProjection {
  switch (action.type) {
    case "snapshot": {
      const active = activeMessageRecords(action.snapshot)
      const activeExecution = activeRun(action.snapshot)
      return {
        ...state,
        messages: active.messages.map(projectMessage).filter((message): message is ChatProjectionMessage => message !== null),
        activeBranchId: action.snapshot.session.active_branch_id,
        ...activeExecution,
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
    case "repair":
      return { ...state, repair: { required: true, reason: action.reason } }
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
          ordinal: message.parts.length,
          version: 1,
          lifecycle: "streaming",
          originalKind: action.originalKind,
        }).message),
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
