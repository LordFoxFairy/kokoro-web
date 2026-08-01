import type { SessionConnectionState } from "@kokoro/session-client"
import stableStringify from "fast-json-stable-stringify"
import type {
  ConversationBranch,
  MessagePartEnvelope,
  MessageRecord,
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"
import { sessionEventContractMetadata } from "@kokoro/session-client/contracts"

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
  readonly branchId: string
  readonly parentMessageId?: string
  readonly triggerMessageId?: string
  readonly runId: string | null
  readonly role: "user" | "assistant"
  readonly createdAt: string
  readonly parts: readonly ChatPart[]
  readonly attachments: readonly {
    readonly assetRef: string
    readonly assetVersionRef: string
    readonly assetGrantRef: string
  }[]
  readonly status: "running" | "complete" | "incomplete"
}

export type ChatSessionMetadata = {
  readonly id: string
  readonly projectRef: string
  readonly title: string
  readonly lifecycle: SessionSnapshot["session"]["lifecycle"]
  readonly contextPolicy: SessionSnapshot["session"]["context_policy"]
  readonly version: number
  readonly activeLeafMessageId?: string
}

export type ChatBranchSummary = {
  readonly id: string
  readonly parentId?: string
  readonly forkedFromMessageId?: string
  readonly rootMessageId?: string
  readonly leafMessageId?: string
  readonly origin: ConversationBranch["origin"]
  readonly version: number
  readonly createdAt: string
}

export type ChatProjection = {
  readonly session: ChatSessionMetadata | null
  readonly branches: readonly ChatBranchSummary[]
  readonly messages: readonly ChatProjectionMessage[]
  readonly activeBranchId: string | null
  readonly snapshotRevision: string | null
  readonly activeRunId: string | null
  readonly activeRunProjectionVersion: number | null
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

type ChatProjectionAction =
  | { readonly type: "snapshot"; readonly snapshot: SessionSnapshot }
  | ChatProjectionMutation
type PartEnvelopeFingerprints = WeakMap<ChatPart, string>
type RunView = SessionSnapshot["runs"][number]
type RunStatus = RunView["execution_status"]
type RunLaunch = SessionSnapshot["run_launches"][number]
type RunLaunchStatus = RunLaunch["status"]
type VersionedEnvelopeFingerprint<Status extends string = string> = Readonly<{
  version: number
  fingerprint: string
  bindingFingerprint: string
  status: Status
}>
type ProjectionEnvelopeAuthority = Readonly<{
  messages: Map<string, string>
  runs: Map<string, VersionedEnvelopeFingerprint<RunStatus>>
  launches: Map<string, VersionedEnvelopeFingerprint<RunLaunchStatus>>
  pairsByRunId: Map<string, RunLaunchPairBinding>
  pairsByLaunchId: Map<string, RunLaunchPairBinding>
}>
type RunLaunchPairBinding = Readonly<{
  runId: string
  launchId: string
  branchId: string
}>
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
const TERMINAL_RUN_STATUSES = new Set<RunStatus>(["completed", "failed", "canceled"])
const TERMINAL_LAUNCH_STATUSES = new Set<RunLaunchStatus>(["released", "denied", "failed"])

const RUN_TRANSITIONS: Readonly<Record<Exclude<RunStatus, "outcome_unknown">, ReadonlySet<RunStatus>>> = {
  admission_pending: new Set(["admission_pending", "waiting_prerequisite", "running", "failed", "outcome_unknown"]),
  waiting_prerequisite: new Set(["waiting_prerequisite", "admission_pending", "running", "failed", "outcome_unknown"]),
  running: new Set(["running", "paused", "cancelling", "completed", "failed", "canceled", "outcome_unknown"]),
  paused: new Set(["paused", "running", "cancelling", "completed", "failed", "canceled", "outcome_unknown"]),
  cancelling: new Set(["cancelling", "running", "completed", "failed", "canceled", "outcome_unknown"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed"]),
  canceled: new Set(["canceled"]),
}

const LAUNCH_TRANSITIONS: Readonly<Record<Exclude<RunLaunchStatus, "outcome_unknown">, ReadonlySet<RunLaunchStatus>>> = {
  intent_recorded: new Set(["intent_recorded", "admission_pending", "denied", "failed", "outcome_unknown"]),
  admission_pending: new Set(["admission_pending", "waiting_prerequisite", "reserved", "denied", "failed", "outcome_unknown"]),
  waiting_prerequisite: new Set(["waiting_prerequisite", "admission_pending", "reserved", "denied", "failed", "outcome_unknown"]),
  reserved: new Set(["reserved", "committed", "released", "failed", "outcome_unknown"]),
  committed: new Set(["committed", "dispatch_pending", "released", "failed", "outcome_unknown"]),
  dispatch_pending: new Set(["dispatch_pending", "dispatched", "released", "failed", "outcome_unknown"]),
  dispatched: new Set(["dispatched", "event_observed", "failed", "outcome_unknown"]),
  event_observed: new Set(["event_observed"]),
  released: new Set(["released"]),
  denied: new Set(["denied"]),
  failed: new Set(["failed"]),
}

function runBinding(run: RunView): string {
  return stableStringify({
    run_id: run.run_id,
    launch_id: run.launch_id,
    branch_id: run.branch_id,
    assistant_message_id: run.assistant_message_id,
  })
}

function launchBinding(launch: RunLaunch): string {
  return stableStringify({
    launch_id: launch.launch_id,
    branch_id: launch.branch_id,
    trigger_message_id: launch.trigger_message_id,
    proposed_run_id: launch.proposed_run_id,
    command_receipt_ref: launch.command_receipt_ref,
  })
}

function runTransitionAllowed(previous: RunStatus, next: RunStatus): boolean {
  if (previous === "outcome_unknown") return true
  if (TERMINAL_RUN_STATUSES.has(previous)) return previous === next
  return RUN_TRANSITIONS[previous].has(next)
}

function launchTransitionAllowed(previous: RunLaunchStatus, next: RunLaunchStatus): boolean {
  if (previous === "outcome_unknown") return true
  if (TERMINAL_LAUNCH_STATUSES.has(previous)) return previous === next
  return LAUNCH_TRANSITIONS[previous].has(next)
}

function emptyEnvelopeAuthority(): ProjectionEnvelopeAuthority {
  return {
    messages: new Map(),
    runs: new Map(),
    launches: new Map(),
    pairsByRunId: new Map(),
    pairsByLaunchId: new Map(),
  }
}

function runPair(run: RunView): RunLaunchPairBinding {
  return { runId: run.run_id, launchId: run.launch_id, branchId: run.branch_id }
}

function launchPair(launch: RunLaunch): RunLaunchPairBinding {
  return { runId: launch.proposed_run_id, launchId: launch.launch_id, branchId: launch.branch_id }
}

function pairBindingMatches(
  authority: ProjectionEnvelopeAuthority,
  pair: RunLaunchPairBinding,
): boolean {
  const byRun = authority.pairsByRunId.get(pair.runId)
  const byLaunch = authority.pairsByLaunchId.get(pair.launchId)
  return (byRun === undefined || stableStringify(byRun) === stableStringify(pair)) &&
    (byLaunch === undefined || stableStringify(byLaunch) === stableStringify(pair))
}

function commitPairBinding(
  authority: ProjectionEnvelopeAuthority,
  pair: RunLaunchPairBinding,
): void {
  authority.pairsByRunId.set(pair.runId, pair)
  authority.pairsByLaunchId.set(pair.launchId, pair)
}

function snapshotEnvelopeAuthority(snapshot: SessionSnapshot): Readonly<{
  authority: ProjectionEnvelopeAuthority
  conflict?:
    | "message_identity_conflict"
    | "run_projection_version_conflict"
    | "run_launch_version_conflict"
    | "run_launch_binding_conflict"
}> {
  const authority = emptyEnvelopeAuthority()
  let conflict:
    | "message_identity_conflict"
    | "run_projection_version_conflict"
    | "run_launch_version_conflict"
    | "run_launch_binding_conflict"
    | undefined
  for (const message of snapshot.messages) {
    if (authority.messages.has(message.message_id)) conflict ??= "message_identity_conflict"
    else authority.messages.set(message.message_id, stableStringify(message))
  }
  for (const run of snapshot.runs) {
    if (authority.runs.has(run.run_id)) conflict ??= "run_projection_version_conflict"
    else {
      const pair = runPair(run)
      if (!pairBindingMatches(authority, pair)) conflict ??= "run_launch_binding_conflict"
      else commitPairBinding(authority, pair)
      authority.runs.set(run.run_id, {
        version: run.projection_version,
        fingerprint: stableStringify(run),
        bindingFingerprint: runBinding(run),
        status: run.execution_status,
      })
    }
  }
  for (const launch of snapshot.run_launches) {
    if (authority.launches.has(launch.launch_id)) conflict ??= "run_launch_version_conflict"
    else {
      const pair = launchPair(launch)
      if (!pairBindingMatches(authority, pair)) conflict ??= "run_launch_binding_conflict"
      else commitPairBinding(authority, pair)
      authority.launches.set(launch.launch_id, {
        version: launch.version,
        fingerprint: stableStringify(launch),
        bindingFingerprint: launchBinding(launch),
        status: launch.status,
      })
    }
  }
  for (const run of snapshot.runs) {
    if (!authority.launches.has(run.launch_id)) conflict ??= "run_launch_binding_conflict"
  }
  return { authority, ...(conflict === undefined ? {} : { conflict }) }
}

type VersionedEnvelopeAdmission<Status extends string> =
  | Readonly<{ admission: "accepted"; next: VersionedEnvelopeFingerprint<Status> }>
  | Readonly<{ admission: "exact_replay" }>
  | Readonly<{ admission: "conflict" }>

function inspectVersionedEnvelope<Status extends string>(
  authority: Map<string, VersionedEnvelopeFingerprint<Status>>,
  id: string,
  version: number,
  envelope: unknown,
  bindingFingerprint: string,
  status: Status,
  transitionAllowed: (previous: Status, next: Status) => boolean,
): VersionedEnvelopeAdmission<Status> {
  const fingerprint = stableStringify(envelope)
  const current = authority.get(id)
  if (current === undefined) {
    if (version !== 1) return { admission: "conflict" }
    return {
      admission: "accepted",
      next: { version, fingerprint, bindingFingerprint, status },
    }
  }
  if (bindingFingerprint !== current.bindingFingerprint) return { admission: "conflict" }
  if (version === current.version && fingerprint === current.fingerprint) return { admission: "exact_replay" }
  if (version !== current.version + 1 || !transitionAllowed(current.status, status)) {
    return { admission: "conflict" }
  }
  return {
    admission: "accepted",
    next: { version, fingerprint, bindingFingerprint, status },
  }
}

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
    session: null,
    branches: [],
    messages: [],
    activeBranchId: null,
    snapshotRevision: null,
    activeRunId: null,
    activeRunProjectionVersion: null,
    activeRunState: null,
    connection: { kind: "idle" },
    command: { state: "idle" },
    repair: { required: false },
  })
}

function projectSessionMetadata(session: SessionSnapshot["session"]): ChatSessionMetadata {
  return {
    id: session.session_id,
    projectRef: session.project_ref,
    title: session.title,
    lifecycle: session.lifecycle,
    contextPolicy: session.context_policy,
    version: session.version,
    ...(session.active_leaf_message_id === undefined ? {} : { activeLeafMessageId: session.active_leaf_message_id }),
  }
}

function projectBranchSummary(branch: ConversationBranch): ChatBranchSummary {
  return {
    id: branch.branch_id,
    origin: branch.origin,
    version: branch.version,
    createdAt: branch.created_at,
    ...(branch.parent_branch_id === undefined ? {} : { parentId: branch.parent_branch_id }),
    ...(branch.forked_from_message_id === undefined ? {} : { forkedFromMessageId: branch.forked_from_message_id }),
    ...(branch.root_message_id === undefined ? {} : { rootMessageId: branch.root_message_id }),
    ...(branch.leaf_message_id === undefined ? {} : { leafMessageId: branch.leaf_message_id }),
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
    branchId: message.branch_id,
    ...(message.parent_message_id === undefined ? {} : { parentMessageId: message.parent_message_id }),
    ...(message.trigger_message_id === undefined ? {} : { triggerMessageId: message.trigger_message_id }),
    runId: message.run_id ?? null,
    role: message.role,
    createdAt: message.created_at,
    parts: sortParts(message.parts.map((part) => projectPart(part, fingerprints))),
    attachments: [...message.attachments].sort((left, right) => left.ordinal - right.ordinal).map((attachment) => ({
      assetRef: attachment.asset_ref,
      assetVersionRef: attachment.asset_version_ref,
      assetGrantRef: attachment.asset_grant_ref,
    })),
    status: messageStatus(message.lifecycle),
  })
}

function appendMessage(
  messages: readonly ChatProjectionMessage[],
  message: ChatProjectionMessage,
): readonly ChatProjectionMessage[] {
  return Object.freeze([...messages, deepFreeze(message)])
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
  const invalid = { messages: [] as readonly MessageRecord[], complete: false }
  const activeBranchId = snapshot.session.active_branch_id
  const branch = snapshot.branches.find((candidate) => candidate.branch_id === activeBranchId)
  if (branch === undefined) return invalid
  const branchMessages = snapshot.messages.filter((message) => message.branch_id === activeBranchId)
  const leafId = snapshot.session.active_leaf_message_id
  if (leafId === undefined) {
    return branch.root_message_id === undefined && branch.leaf_message_id === undefined && branchMessages.length === 0
      ? { messages: [], complete: true }
      : invalid
  }
  const rootId = branch.root_message_id
  if (rootId === undefined || branch.leaf_message_id !== leafId) return invalid
  const byId = new Map(branchMessages.map((message) => [message.message_id, message]))
  if (byId.size !== branchMessages.length) return invalid
  const seen = new Set<string>()
  const reverse: MessageRecord[] = []
  let currentId: string | undefined = leafId
  while (currentId !== undefined) {
    if (seen.has(currentId)) return invalid
    seen.add(currentId)
    const message = byId.get(currentId)
    if (message === undefined || message.branch_id !== activeBranchId) return invalid
    reverse.push(message)
    if (message.message_id === rootId) break
    currentId = message.parent_message_id
  }
  const messages = reverse.reverse()
  if (
    messages[0]?.message_id !== rootId ||
    messages.at(-1)?.message_id !== leafId ||
    messages.length !== branchMessages.length ||
    messages.some((message, index) =>
      message.ordinal !== index ||
      index > 0 && message.parent_message_id !== messages[index - 1]?.message_id)
  ) return invalid
  return { messages, complete: true }
}

type ActiveExecution = Pick<
  ChatProjection,
  "activeRunId" | "activeRunProjectionVersion" | "activeRunState"
>

const NO_ACTIVE_EXECUTION: ActiveExecution = {
  activeRunId: null,
  activeRunProjectionVersion: null,
  activeRunState: null,
}

function activeRun(
  snapshot: SessionSnapshot,
  authority: ProjectionEnvelopeAuthority,
): Readonly<{
  execution: ActiveExecution
  conflict?: "run_launch_binding_conflict"
}> {
  const candidates = snapshot.runs.filter((run) =>
    run.branch_id === snapshot.session.active_branch_id && ACTIVE_RUN_STATUSES.has(run.execution_status),
  )
  const launchCandidates = snapshot.run_launches.filter((candidate) =>
    candidate.branch_id === snapshot.session.active_branch_id &&
    ACTIVE_LAUNCH_STATUSES.has(candidate.status) &&
    !authority.runs.has(candidate.proposed_run_id),
  )
  if (candidates.length + launchCandidates.length > 1) {
    return { execution: NO_ACTIVE_EXECUTION, conflict: "run_launch_binding_conflict" }
  }
  const run = candidates[0]
  const launch = launchCandidates[0]
  const runId = run?.run_id ?? launch?.proposed_run_id ?? null
  if (runId === null) return { execution: NO_ACTIVE_EXECUTION }
  const activeRunProjectionVersion = run?.projection_version ?? null
  const cancelling = snapshot.controls.some((control) =>
    control.run_id === runId && control.kind === "cancel" && ["pending", "persisted", "applied", "outcome_unknown"].includes(control.status),
  )
  if (cancelling) {
    return { execution: { activeRunId: runId, activeRunProjectionVersion, activeRunState: "cancelling" } }
  }
  if (run?.execution_status === "paused") {
    return { execution: { activeRunId: runId, activeRunProjectionVersion, activeRunState: "paused" } }
  }
  if (run?.execution_status === "outcome_unknown" || launch?.status === "outcome_unknown") {
    return { execution: { activeRunId: runId, activeRunProjectionVersion, activeRunState: "outcome_unknown" } }
  }
  return {
    execution: {
      activeRunId: runId,
      activeRunProjectionVersion,
      activeRunState: run === undefined ? "launching" : "running",
    },
  }
}

function updateActivePairProjection(
  state: ChatProjection,
  authority: ProjectionEnvelopeAuthority,
  pair: RunLaunchPairBinding,
): ChatProjection | "conflict" {
  if (pair.branchId !== state.activeBranchId) return state
  const run = authority.runs.get(pair.runId)
  const launch = authority.launches.get(pair.launchId)
  if (run === undefined || launch === undefined) {
    if (run === undefined && launch !== undefined && state.activeRunId === pair.runId && state.activeRunProjectionVersion === null) {
      if (TERMINAL_LAUNCH_STATUSES.has(launch.status)) return { ...state, ...NO_ACTIVE_EXECUTION }
      return {
        ...state,
        activeRunState: launch.status === "outcome_unknown" ? "outcome_unknown" : "launching",
      }
    }
    return state
  }
  if (TERMINAL_RUN_STATUSES.has(run.status)) {
    return state.activeRunId === pair.runId ? { ...state, ...NO_ACTIVE_EXECUTION } : state
  }
  if (
    TERMINAL_LAUNCH_STATUSES.has(launch.status) &&
    state.activeRunId !== pair.runId
  ) return state
  if (state.activeRunId !== null && state.activeRunId !== pair.runId) return "conflict"
  return {
    ...state,
    activeRunId: pair.runId,
    activeRunProjectionVersion: run.version,
    activeRunState: run.status === "paused" || run.status === "cancelling" || run.status === "outcome_unknown"
      ? run.status
      : "running",
  }
}

function activePairProjectionWouldConflict(
  state: ChatProjection,
  authority: ProjectionEnvelopeAuthority,
  pair: RunLaunchPairBinding,
  nextRun?: VersionedEnvelopeFingerprint<RunStatus>,
  nextLaunch?: VersionedEnvelopeFingerprint<RunLaunchStatus>,
): boolean {
  if (pair.branchId !== state.activeBranchId) return false
  const run = nextRun ?? authority.runs.get(pair.runId)
  const launch = nextLaunch ?? authority.launches.get(pair.launchId)
  if (run === undefined || launch === undefined || TERMINAL_RUN_STATUSES.has(run.status)) return false
  if (TERMINAL_LAUNCH_STATUSES.has(launch.status) && state.activeRunId !== pair.runId) return false
  return state.activeRunId !== null && state.activeRunId !== pair.runId
}

function activeMessageExtension(
  state: ChatProjection,
  record: MessageRecord,
): Readonly<{
  session: ChatSessionMetadata
  branches: readonly ChatBranchSummary[]
}> | null {
  const session = state.session
  const activeBranchId = state.activeBranchId
  if (session === null || activeBranchId === null || record.branch_id !== activeBranchId || record.role === "system") {
    return null
  }
  const branchIndex = state.branches.findIndex((branch) => branch.id === activeBranchId)
  const branch = state.branches[branchIndex]
  if (branch === undefined) return null
  const first = state.messages[0]
  const leaf = state.messages.at(-1)
  const empty = state.messages.length === 0
  const lineageComplete = empty
    ? branch.rootMessageId === undefined && branch.leafMessageId === undefined && session.activeLeafMessageId === undefined
    : first !== undefined && leaf !== undefined &&
      branch.rootMessageId === first.id &&
      branch.leafMessageId === leaf.id &&
      session.activeLeafMessageId === leaf.id &&
      state.messages.every((message, index) =>
        message.branchId === activeBranchId &&
        (index === 0 ? message.parentMessageId === undefined : message.parentMessageId === state.messages[index - 1]?.id))
  if (
    !lineageComplete ||
    record.ordinal !== state.messages.length ||
    (empty ? record.parent_message_id !== undefined : record.parent_message_id !== leaf?.id)
  ) return null
  const nextBranch: ChatBranchSummary = {
    ...branch,
    rootMessageId: branch.rootMessageId ?? record.message_id,
    leafMessageId: record.message_id,
  }
  const branches = [...state.branches]
  branches[branchIndex] = deepFreeze(nextBranch)
  return {
    session: { ...session, activeLeafMessageId: record.message_id },
    branches: Object.freeze(branches),
  }
}

function reduceEvent(
  state: ChatProjection,
  event: SessionEvent,
  fingerprints: PartEnvelopeFingerprints,
  envelopes: ProjectionEnvelopeAuthority,
  indexes: ProjectionIndexes,
): ChatProjection {
  const session = state.session
  if (session === null) {
    return { ...state, repair: { required: true, reason: "event_without_snapshot" } }
  }
  if (event.schema_revision !== sessionEventContractMetadata.schemaVersion) {
    return { ...state, repair: { required: true, reason: "event_schema_revision_conflict" } }
  }
  if (event.session_id !== session.id) {
    return { ...state, repair: { required: true, reason: "session_identity_conflict" } }
  }
  let next: ChatProjection
  switch (event.kind) {
    case "message.created": {
      const record = event.payload.message
      const fingerprint = stableStringify(record)
      const currentFingerprint = envelopes.messages.get(record.message_id)
      if (currentFingerprint !== undefined) {
        if (currentFingerprint !== fingerprint) {
          return { ...state, repair: { required: true, reason: "message_identity_conflict" } }
        }
        next = state
        break
      }
      if (record.branch_id !== state.activeBranchId) {
        if (!state.branches.some((branch) => branch.id === record.branch_id)) {
          return { ...state, repair: { required: true, reason: "message_lineage_conflict" } }
        }
        envelopes.messages.set(record.message_id, fingerprint)
        next = state
        break
      }
      const extension = activeMessageExtension(state, record)
      if (extension === null) {
        return { ...state, repair: { required: true, reason: "message_lineage_conflict" } }
      }
      const message = projectMessage(record, fingerprints)
      if (message === null) {
        return { ...state, repair: { required: true, reason: "message_lineage_conflict" } }
      }
      envelopes.messages.set(record.message_id, fingerprint)
      next = {
        ...state,
        session: extension.session,
        branches: extension.branches,
        messages: appendMessage(state.messages, message),
        repair: state.repair.required
          ? state.repair
          : { required: true, reason: "active_branch_authority_stale" },
      }
      break
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
      if (result.message === currentMessage) {
        next = state
      } else {
        const messages = [...state.messages]
        messages[index] = deepFreeze(result.message)
        next = { ...state, messages: Object.freeze(messages) }
      }
      break
    }
    case "run.launch.updated": {
      const launch = event.payload.launch
      const pair = launchPair(launch)
      if (!pairBindingMatches(envelopes, pair)) {
        return { ...state, repair: { required: true, reason: "run_launch_binding_conflict" } }
      }
      const inspected = inspectVersionedEnvelope(
        envelopes.launches,
        launch.launch_id,
        launch.version,
        launch,
        launchBinding(launch),
        launch.status,
        launchTransitionAllowed,
      )
      if (inspected.admission === "conflict") {
        return { ...state, repair: { required: true, reason: "run_launch_version_conflict" } }
      }
      if (inspected.admission === "exact_replay") return state
      if (activePairProjectionWouldConflict(state, envelopes, pair, undefined, inspected.next)) {
        return { ...state, repair: { required: true, reason: "run_launch_binding_conflict" } }
      }
      commitPairBinding(envelopes, pair)
      envelopes.launches.set(launch.launch_id, inspected.next)
      const projected = updateActivePairProjection(state, envelopes, pair)
      if (projected === "conflict") {
        return { ...state, repair: { required: true, reason: "run_launch_binding_conflict" } }
      }
      next = projected
      break
    }
    case "run.view.updated": {
      const run = event.payload.run
      const pair = runPair(run)
      if (!pairBindingMatches(envelopes, pair)) {
        return { ...state, repair: { required: true, reason: "run_launch_binding_conflict" } }
      }
      const inspected = inspectVersionedEnvelope(
        envelopes.runs,
        run.run_id,
        run.projection_version,
        run,
        runBinding(run),
        run.execution_status,
        runTransitionAllowed,
      )
      if (inspected.admission === "conflict") {
        return { ...state, repair: { required: true, reason: "run_projection_version_conflict" } }
      }
      if (inspected.admission === "exact_replay") return state
      if (activePairProjectionWouldConflict(state, envelopes, pair, inspected.next)) {
        return { ...state, repair: { required: true, reason: "run_launch_binding_conflict" } }
      }
      if (run.branch_id !== state.activeBranchId) {
        commitPairBinding(envelopes, pair)
        envelopes.runs.set(run.run_id, inspected.next)
        next = state
        break
      }
      commitPairBinding(envelopes, pair)
      envelopes.runs.set(run.run_id, inspected.next)
      const projected = updateActivePairProjection(state, envelopes, pair)
      if (projected === "conflict") {
        return { ...state, repair: { required: true, reason: "run_launch_binding_conflict" } }
      }
      const active = ACTIVE_RUN_STATUSES.has(run.execution_status)
      const messages = state.messages.map((message) =>
        message.runId === run.run_id && !active
          ? { ...message, status: run.execution_status === "completed" ? "complete" as const : "incomplete" as const }
          : message,
      )
      next = {
        ...projected,
        messages,
      }
      break
    }
    case "run.control.updated": {
      const control = event.payload.control
      if (control.run_id !== state.activeRunId || control.kind !== "cancel") {
        next = state
        break
      }
      if (["pending", "persisted", "applied", "outcome_unknown"].includes(control.status)) {
        next = { ...state, activeRunState: control.status === "outcome_unknown" ? "outcome_unknown" : "cancelling" }
        break
      }
      next = control.status === "failed" ? { ...state, activeRunState: "running" } : state
      break
    }
    case "branch.activated": {
      if (!state.branches.some((branch) => branch.id === event.payload.branch_id)) {
        return { ...state, repair: { required: true, reason: "branch_activation_unknown" } }
      }
      if (event.payload.session_version < session.version) {
        return { ...state, repair: { required: true, reason: "session_version_regression" } }
      }
      if (event.payload.session_version > session.version + 1) {
        return { ...state, repair: { required: true, reason: "session_version_gap" } }
      }
      if (event.payload.session_version === session.version) {
        const activeLeafMessageId = event.payload.active_leaf_message_id
        if (
          event.payload.branch_id !== state.activeBranchId ||
          activeLeafMessageId !== session.activeLeafMessageId
        ) {
          return { ...state, repair: { required: true, reason: "session_version_conflict" } }
        }
        next = state
        break
      }
      next = {
        ...state,
        session: {
          ...session,
          version: event.payload.session_version,
          ...(event.payload.active_leaf_message_id === undefined
            ? { activeLeafMessageId: undefined }
            : { activeLeafMessageId: event.payload.active_leaf_message_id }),
        },
        messages: [],
        activeBranchId: event.payload.branch_id,
        activeRunId: null,
        activeRunProjectionVersion: null,
        activeRunState: null,
        repair: { required: true, reason: "active_branch_changed_refetch_snapshot" },
      }
      break
    }
    case "session.updated": {
      const updated = projectSessionMetadata(event.payload.session)
      if (
        updated.id !== session.id ||
        updated.projectRef !== session.projectRef ||
        updated.contextPolicy !== session.contextPolicy ||
        updated.version < session.version ||
        updated.version > session.version + 1
      ) {
        return { ...state, repair: { required: true, reason: "session_metadata_conflict" } }
      }
      if (updated.version === session.version) {
        if (
          stableStringify(updated) !== stableStringify(session) ||
          event.payload.session.active_branch_id !== state.activeBranchId
        ) {
          return { ...state, repair: { required: true, reason: "session_metadata_conflict" } }
        }
        next = state
        break
      }
      if (event.payload.session.active_branch_id === state.activeBranchId) {
        if (updated.activeLeafMessageId !== session.activeLeafMessageId) {
          return { ...state, repair: { required: true, reason: "active_leaf_changed_refetch_snapshot" } }
        }
        next = { ...state, session: updated }
        break
      }
      if (!state.branches.some((branch) => branch.id === event.payload.session.active_branch_id)) {
        return { ...state, repair: { required: true, reason: "session_active_branch_unknown" } }
      }
      next = {
        ...state,
        session: updated,
        messages: [],
        activeBranchId: event.payload.session.active_branch_id,
        activeRunId: null,
        activeRunProjectionVersion: null,
        activeRunState: null,
        repair: { required: true, reason: "active_branch_changed_refetch_snapshot" },
      }
      break
    }
    case "branch.created": {
      const branch = projectBranchSummary(event.payload.branch)
      if (branch.version !== 1) {
        return { ...state, repair: { required: true, reason: "branch_initial_version_conflict" } }
      }
      const existing = state.branches.find((candidate) => candidate.id === branch.id)
      if (existing !== undefined) {
        if (stableStringify(existing) !== stableStringify(branch)) {
          return { ...state, repair: { required: true, reason: "branch_identity_conflict" } }
        }
        next = state
        break
      }
      if (branch.parentId !== undefined && !state.branches.some((candidate) => candidate.id === branch.parentId)) {
        return { ...state, repair: { required: true, reason: "branch_parent_unknown" } }
      }
      next = { ...state, branches: Object.freeze([...state.branches, deepFreeze(branch)]) }
      break
    }
    case "run.cost.updated":
    case "command.receipt.updated":
      next = state
      break
  }
  return next
}

function reduceChatProjection(
  state: ChatProjection,
  action: ChatProjectionAction,
  fingerprints: PartEnvelopeFingerprints,
  envelopes: ProjectionEnvelopeAuthority,
  indexes: ProjectionIndexes,
): ChatProjection {
  switch (action.type) {
    case "snapshot": {
      const base = createChatProjection()
      const session = projectSessionMetadata(action.snapshot.session)
      const branches = action.snapshot.branches.map(projectBranchSummary)
      const branchIds = new Set(branches.map((branch) => branch.id))
      const branchIdentityComplete = branchIds.size === branches.length
      const activeBranchExists = branchIds.has(action.snapshot.session.active_branch_id)
      const active = activeMessageRecords(action.snapshot)
      const activeExecution = activeRun(action.snapshot, envelopes)
      return {
        ...base,
        connection: state.connection,
        command: state.command,
        session,
        branches,
        messages: activeBranchExists ? active.messages
          .map((message) => projectMessage(message, fingerprints))
          .filter((message): message is ChatProjectionMessage => message !== null) : [],
        activeBranchId: action.snapshot.session.active_branch_id,
        snapshotRevision: action.snapshot.snapshot_watermark.cursor,
        ...activeExecution.execution,
        repair: !branchIdentityComplete
          ? { required: true, reason: "branch_identity_conflict" }
          : !activeBranchExists
            ? { required: true, reason: "snapshot_active_branch_missing" }
            : !active.complete
              ? { required: true, reason: "snapshot_active_lineage_incomplete" }
              : activeExecution.conflict === undefined
                ? { required: false }
                : { required: true, reason: activeExecution.conflict },
      }
    }
    case "event":
      return reduceEvent(state, action.event, fingerprints, envelopes, indexes)
    case "connection":
      return { ...state, connection: copyUnknown(action.connection) as SessionConnectionState }
    case "command":
      return { ...state, command: { state: action.state, ...(action.detail ? { detail: action.detail } : {}) } }
    case "repair":
      return { ...state, repair: { required: true, reason: action.reason } }
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
  let envelopes = emptyEnvelopeAuthority()
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
      const nextEnvelopes = snapshotEnvelopeAuthority(snapshot)
      let next = reduceChatProjection(
        state,
        { type: "snapshot", snapshot },
        nextFingerprints,
        nextEnvelopes.authority,
        indexes,
      )
      const built = buildProjectionIndexes(next.messages)
      const conflict = nextEnvelopes.conflict ?? built.conflict
      if (conflict !== undefined) {
        next = { ...next, repair: { required: true, reason: conflict } }
      }
      fingerprints = nextFingerprints
      envelopes = nextEnvelopes.authority
      indexes = built.indexes
      commit(next)
    },
    reset() {
      fingerprints = new WeakMap()
      envelopes = emptyEnvelopeAuthority()
      const next = createChatProjection()
      indexes = buildProjectionIndexes(next.messages).indexes
      commit(next)
    },
    dispatch(action) {
      let next = reduceChatProjection(state, action, fingerprints, envelopes, indexes)
      if (next !== state && next.messages !== state.messages) {
        if (action.type === "event" && action.event.kind === "message.part.updated") {
          indexes.partOwnerById.set(action.event.payload.part.part_id, action.event.payload.part.message_id)
        } else if (action.type === "event" && ["message.created", "branch.activated", "session.updated"].includes(action.event.kind)) {
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
