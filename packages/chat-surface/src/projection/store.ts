import type { SessionConnectionState } from "@kokoro/session-client"
import stableStringify from "fast-json-stable-stringify"
import type {
  MessagePartEnvelope,
  MessageRecord,
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"

import {
  projectArtifactOwnerState,
  projectCostOwnerState,
  projectMediaOperationOwnerState,
  validateArtifactTransition,
  validateCostTransition,
  validateMediaOperationTransition,
  type ChatArtifactOwnerState,
  type ChatCostOwnerState,
  type ChatMediaOperationOwnerState,
  type OwnerTransitionConflict,
} from "./owner-state.js"

type ChatPartBase = {
  readonly id: string
  readonly ordinal: number
  readonly version: number
  readonly lifecycle: MessagePartEnvelope["lifecycle"]
}

type PartPayload<Kind extends MessagePartEnvelope["kind"]> =
  Extract<MessagePartEnvelope, { readonly kind: Kind }>["payload"]

export type ChatPart = ChatPartBase & (
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reasoning-summary"; readonly partRef: string; readonly text: string }
  | {
      readonly kind: "citation"
      readonly sourceRef: string
      readonly title: string
      readonly locator?: string
      readonly attribution?: string
    }
  | {
      readonly kind: "tool"
      readonly toolCallId: string
      readonly name: string
      readonly args: Record<string, unknown>
      readonly result?: string
      readonly status: "running" | "awaiting" | "complete" | "error" | "incomplete"
      readonly isError?: PartPayload<"tool-call">["is_error"]
      readonly truncated?: PartPayload<"tool-call">["truncated"]
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
      readonly allowedActions: PartPayload<"approval" | "interaction">["allowed_actions"]
      readonly receiptRef?: string
      readonly status: PartPayload<"approval" | "interaction">["status"]
    }
  | {
      readonly kind: "plan"
      readonly planProposalRef: string
      readonly planVersion: number
      readonly summary: string
      readonly steps: readonly { readonly stepRef: string; readonly label: string; readonly status: string }[]
      readonly allowedActions: PartPayload<"plan">["allowed_actions"]
      readonly deadline?: string
      readonly receiptRef?: string
      readonly status: PartPayload<"plan">["status"]
    }
  | {
      readonly kind: "plan-progress"
      readonly planRef: string
      readonly summary: string
      readonly steps: readonly { readonly stepRef: string; readonly label: string; readonly status: string }[]
    }
  | {
      readonly kind: "subagent"
      readonly subagentRef: string
      readonly status: PartPayload<"subagent">["status"]
      readonly summary?: string
    }
  | ({ readonly kind: "media-operation" } & ChatMediaOperationOwnerState)
  | ({ readonly kind: "artifact" } & ChatArtifactOwnerState)
  | ({ readonly kind: "cost" } & ChatCostOwnerState)
  | {
      readonly kind: "notice"
      readonly noticeRef: string
      readonly code: string
      readonly message: string
      readonly severity: PartPayload<"notice">["severity"]
      readonly retryClass?: PartPayload<"notice">["retry_class"]
      readonly supportCorrelationRef?: string
    }
  | {
      readonly kind: "error"
      readonly errorRef: string
      readonly code: string
      readonly message: string
      readonly retryClass: PartPayload<"error">["retry_class"]
      readonly supportCorrelationRef?: string
    }
  | {
      readonly kind: "unsupported"
      readonly originalKind: string
      readonly originalSchemaVersion: number
      readonly safeFallback: string
    }
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

export type ChatProjectionMutation =
  | { readonly type: "event"; readonly event: SessionEvent }
  | { readonly type: "connection"; readonly connection: SessionConnectionState }
  | {
      readonly type: "command"
      readonly state: ChatProjection["command"]["state"]
      readonly detail?: string
    }
  | { readonly type: "repair"; readonly reason: string }
  | { readonly type: "unsupported"; readonly runId: string; readonly originalKind: string }

type ChatProjectionAction =
  | { readonly type: "snapshot"; readonly snapshot: SessionSnapshot }
  | ChatProjectionMutation
type PartEnvelopeFingerprints = WeakMap<ChatPart, string>
type ProjectionIndexes = Readonly<{
  messageIndexById: Map<string, number>
  partOwnerById: Map<string, string>
}>

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

function copyUnknown(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyUnknown)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, copyUnknown(nested)]),
    )
  }
  return value
}

function copyRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return copyUnknown(value) as Record<string, unknown>
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

export function createChatProjection(): ChatProjection {
  return deepFreeze({
    messages: [],
    activeBranchId: null,
    activeRunId: null,
    activeRunState: null,
    connection: { kind: "idle" },
    command: { state: "idle" },
    repair: { required: false },
  })
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

function projectPartView(part: MessagePartEnvelope): ChatPart {
  const base = {
    id: part.part_id,
    ordinal: part.ordinal,
    version: part.version,
    lifecycle: part.lifecycle,
  }
  switch (part.kind) {
    case "text":
      return { ...base, kind: "text", text: part.payload.spans.map((span) => span.text).join("") }
    case "reasoning-summary":
      return {
        ...base,
        kind: "reasoning-summary",
        partRef: part.payload.part_ref,
        text: part.payload.safe_summary,
      }
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
        toolCallId: part.payload.tool_call_id,
        name: part.payload.tool_label,
        args: copyRecord(part.payload.input_summary ?? {}),
        status: toolStatus(part),
        ...(part.payload.safe_result_preview === undefined ? {} : { result: part.payload.safe_result_preview }),
        ...(part.payload.is_error === undefined ? {} : { isError: part.payload.is_error }),
        ...(part.payload.truncated === undefined ? {} : { truncated: part.payload.truncated }),
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
        requiredOwnerRefs: [...part.payload.required_owner_refs],
        title: part.payload.title,
        description: part.payload.description,
        allowedActions: [...part.payload.allowed_actions],
        status: part.payload.status,
        ...(part.payload.risk_summary === undefined ? {} : { riskSummary: part.payload.risk_summary }),
        ...(part.payload.safe_request_summary === undefined ? {} : { safeRequestSummary: copyRecord(part.payload.safe_request_summary) }),
        ...(part.payload.input_schema_ref === undefined ? {} : { inputSchemaRef: part.payload.input_schema_ref }),
        ...(part.payload.safe_input_schema === undefined ? {} : { safeInputSchema: copyRecord(part.payload.safe_input_schema) }),
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
        allowedActions: [...part.payload.allowed_actions],
        status: part.payload.status,
        ...(part.payload.deadline === undefined ? {} : { deadline: part.payload.deadline }),
        ...(part.payload.receipt_ref === undefined ? {} : { receiptRef: part.payload.receipt_ref }),
      }
    case "plan-progress":
      return {
        ...base,
        kind: "plan-progress",
        planRef: part.payload.plan_ref,
        summary: part.payload.safe_summary,
        steps: part.payload.steps.map((step) => ({ stepRef: step.step_ref, label: step.label, status: step.status })),
      }
    case "subagent":
      return {
        ...base,
        kind: "subagent",
        subagentRef: part.payload.subagent_ref,
        status: part.payload.status,
        ...(part.payload.safe_summary === undefined ? {} : { summary: part.payload.safe_summary }),
      }
    case "media-operation":
      return {
        ...base,
        kind: "media-operation",
        ...projectMediaOperationOwnerState(part.payload),
      }
    case "artifact":
      return {
        ...base,
        kind: "artifact",
        ...projectArtifactOwnerState(part.payload),
      }
    case "cost":
      return {
        ...base,
        kind: "cost",
        ...projectCostOwnerState(part.payload),
      }
    case "notice":
      return {
        ...base,
        kind: "notice",
        noticeRef: part.payload.notice_ref,
        code: part.payload.code,
        message: part.payload.message,
        severity: part.payload.severity,
        ...(part.payload.retry_class === undefined ? {} : { retryClass: part.payload.retry_class }),
        ...(part.payload.support_correlation_ref === undefined ? {} : { supportCorrelationRef: part.payload.support_correlation_ref }),
      }
    case "error":
      return {
        ...base,
        kind: "error",
        errorRef: part.payload.error_ref,
        code: part.payload.code,
        message: part.payload.message,
        retryClass: part.payload.retry_class,
        ...(part.payload.support_correlation_ref === undefined ? {} : { supportCorrelationRef: part.payload.support_correlation_ref }),
      }
    case "unsupported":
      return {
        ...base,
        kind: "unsupported",
        originalKind: part.payload.original_kind,
        originalSchemaVersion: part.payload.original_schema_version,
        safeFallback: part.payload.safe_fallback,
      }
  }
}

function projectPart(part: MessagePartEnvelope, fingerprints: PartEnvelopeFingerprints): ChatPart {
  const projected = deepFreeze(projectPartView(part))
  fingerprints.set(projected, stableStringify(part))
  return projected
}

function sortParts(parts: readonly ChatPart[]): readonly ChatPart[] {
  return [...parts].sort((left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id))
}

function projectMessage(
  message: MessageRecord,
  fingerprints: PartEnvelopeFingerprints,
): ChatProjectionMessage | null {
  if (message.role === "system") return null
  return deepFreeze({
    id: message.message_id,
    runId: message.run_id ?? null,
    role: message.role,
    createdAt: message.created_at,
    parts: sortParts(message.parts.map((part) => projectPart(part, fingerprints))),
    status: messageStatus(message.lifecycle),
  })
}

function upsertMessage(
  messages: readonly ChatProjectionMessage[],
  message: ChatProjectionMessage,
  knownIndex?: number,
): readonly ChatProjectionMessage[] {
  const index = knownIndex ?? -1
  const frozenMessage = deepFreeze(message)
  if (index < 0) return Object.freeze([...messages, frozenMessage])
  const next = [...messages]
  next[index] = frozenMessage
  return Object.freeze(next)
}

function buildProjectionIndexes(messages: readonly ChatProjectionMessage[]): Readonly<{
  indexes: ProjectionIndexes
  conflict?: "message_identity_conflict" | "part_identity_conflict"
}> {
  const messageIndexById = new Map<string, number>()
  const partOwnerById = new Map<string, string>()
  let conflict: "message_identity_conflict" | "part_identity_conflict" | undefined
  for (const [index, message] of messages.entries()) {
    if (messageIndexById.has(message.id)) conflict ??= "message_identity_conflict"
    else messageIndexById.set(message.id, index)
    for (const part of message.parts) {
      if (partOwnerById.has(part.id)) conflict ??= "part_identity_conflict"
      else partOwnerById.set(part.id, message.id)
    }
  }
  return {
    indexes: Object.freeze({ messageIndexById, partOwnerById }),
    ...(conflict === undefined ? {} : { conflict }),
  }
}

function upsertPart(
  message: ChatProjectionMessage,
  part: ChatPart,
  fingerprints: PartEnvelopeFingerprints,
): {
  readonly message: ChatProjectionMessage
  readonly conflict?:
    | "part_identity_conflict"
    | "part_version_regression"
    | "part_version_conflict"
    | "part_version_gap"
    | OwnerTransitionConflict
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
    const currentFingerprint = fingerprints.get(current)
    return currentFingerprint !== undefined && currentFingerprint === fingerprints.get(part)
      ? { message }
      : { message, conflict: "part_version_conflict" }
  }
  if (part.version !== current.version + 1) return { message, conflict: "part_version_gap" }
  const ownerConflict = current.kind === "media-operation" && part.kind === "media-operation"
    ? validateMediaOperationTransition(current, part)
    : current.kind === "artifact" && part.kind === "artifact"
      ? validateArtifactTransition(current, part)
      : current.kind === "cost" && part.kind === "cost"
        ? validateCostTransition(current, part)
        : undefined
  if (ownerConflict !== undefined) return { message, conflict: ownerConflict }
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

function reduceEvent(
  state: ChatProjection,
  event: SessionEvent,
  fingerprints: PartEnvelopeFingerprints,
  indexes: ProjectionIndexes,
): ChatProjection {
  switch (event.kind) {
    case "message.created": {
      if (event.payload.message.branch_id !== state.activeBranchId) return state
      const message = projectMessage(event.payload.message, fingerprints)
      return message === null ? state : {
        ...state,
        messages: upsertMessage(state.messages, message, indexes.messageIndexById.get(message.id)),
      }
    }
    case "message.part.updated": {
      const part = event.payload.part
      const ownerId = indexes.partOwnerById.get(part.part_id)
      if (ownerId !== undefined && ownerId !== part.message_id) {
        return { ...state, repair: { required: true, reason: "part_identity_conflict" } }
      }
      const index = indexes.messageIndexById.get(part.message_id)
      if (index === undefined) {
        return { ...state, repair: { required: true, reason: "message_part_without_message" } }
      }
      const currentMessage = state.messages[index] as ChatProjectionMessage
      const result = upsertPart(currentMessage, projectPart(part, fingerprints), fingerprints)
      if (result.conflict !== undefined) {
        return { ...state, repair: { required: true, reason: result.conflict } }
      }
      if (result.message === currentMessage) return state
      const messages = [...state.messages]
      messages[index] = deepFreeze(result.message)
      return { ...state, messages: Object.freeze(messages) }
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

function reduceChatProjection(
  state: ChatProjection,
  action: ChatProjectionAction,
  fingerprints: PartEnvelopeFingerprints,
  indexes: ProjectionIndexes,
): ChatProjection {
  switch (action.type) {
    case "snapshot": {
      const active = activeMessageRecords(action.snapshot)
      const activeExecution = activeRun(action.snapshot)
      return {
        ...state,
        messages: active.messages
          .map((message) => projectMessage(message, fingerprints))
          .filter((message): message is ChatProjectionMessage => message !== null),
        activeBranchId: action.snapshot.session.active_branch_id,
        ...activeExecution,
        repair: active.complete
          ? { required: false }
          : { required: true, reason: "snapshot_active_lineage_incomplete" },
      }
    }
    case "event":
      return reduceEvent(state, action.event, fingerprints, indexes)
    case "connection":
      return { ...state, connection: copyUnknown(action.connection) as SessionConnectionState }
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
          originalSchemaVersion: 1,
          safeFallback: "This content requires a newer client.",
        }, fingerprints).message, indexes.messageIndexById.get(message.id)),
      }
    }
  }
}

export type ChatProjectionStore = {
  readonly getSnapshot: () => ChatProjection
  readonly subscribe: (listener: () => void) => () => void
  readonly hydrate: (snapshot: SessionSnapshot) => void
  readonly reset: () => void
  readonly dispatch: (action: ChatProjectionMutation) => void
}

export function createChatProjectionStore(): ChatProjectionStore {
  let state = createChatProjection()
  let fingerprints: PartEnvelopeFingerprints = new WeakMap()
  let indexes = buildProjectionIndexes(state.messages).indexes
  const listeners = new Set<() => void>()
  const commit = (next: ChatProjection): void => {
    if (next === state) return
    state = deepFreeze(next)
    for (const listener of listeners) listener()
  }
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    hydrate(snapshot) {
      const nextFingerprints: PartEnvelopeFingerprints = new WeakMap()
      let next = reduceChatProjection(state, { type: "snapshot", snapshot }, nextFingerprints, indexes)
      const built = buildProjectionIndexes(next.messages)
      if (built.conflict !== undefined) {
        next = { ...next, repair: { required: true, reason: built.conflict } }
      }
      fingerprints = nextFingerprints
      indexes = built.indexes
      commit(next)
    },
    reset() {
      fingerprints = new WeakMap()
      const next = createChatProjection()
      indexes = buildProjectionIndexes(next.messages).indexes
      commit(next)
    },
    dispatch(action) {
      let next = reduceChatProjection(state, action, fingerprints, indexes)
      if (next !== state && next.messages !== state.messages) {
        if (action.type === "event" && action.event.kind === "message.part.updated") {
          indexes.partOwnerById.set(action.event.payload.part.part_id, action.event.payload.part.message_id)
        } else if (
          action.type === "unsupported" ||
          action.type === "event" && ["message.created", "branch.activated", "session.updated"].includes(action.event.kind)
        ) {
          const built = buildProjectionIndexes(next.messages)
          indexes = built.indexes
          if (built.conflict !== undefined) {
            next = { ...next, repair: { required: true, reason: built.conflict } }
          }
        }
      }
      commit(next)
    },
  }
}
