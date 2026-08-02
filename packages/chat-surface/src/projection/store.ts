import type { SessionConnectionState } from "@kokoro/session-client"
import type {
  AguiActivityEvent,
  AguiPresentationSnapshotAuthority,
} from "@kokoro/session-client/agui-presentation"
import stableStringify from "fast-json-stable-stringify"
import type {
  ConversationBranch,
  MessagePartEnvelope,
  MessageRecord,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"

import {
  projectAguiArtifactOwnerState,
  projectAguiCostOwnerState,
  projectAguiMediaOperationOwnerState,
  projectArtifactOwnerState,
  projectCostOwnerState,
  projectMediaOperationOwnerState,
  type ChatArtifactOwnerState,
  type ChatCostOwnerState,
  type ChatMediaOperationOwnerState,
  validateArtifactTransition,
  validateCostTransition,
  validateMediaOperationTransition,
} from "./owner-state.js"
import type { ChatAguiPresentationMutation } from "../runtime/agui-presentation-adapter.js"

type ChatPartBase = {
  readonly id: string
  readonly ordinal: number
  readonly version: number
  /** Opaque uint64 authority for AG-UI replacements; snapshot part version remains numeric. */
  readonly presentationVersion?: string
  readonly lifecycle: MessagePartEnvelope["lifecycle"]
}

type PartPayload<Kind extends MessagePartEnvelope["kind"]> =
  Extract<MessagePartEnvelope, { readonly kind: Kind }>["payload"]

export type ChatPart = ChatPartBase & (
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "reasoning-summary"
      readonly partRef: string
      readonly text: string
      readonly status?: "streaming" | "complete" | "partial" | "failed" | "canceled"
      readonly ownerVersion?: string
      readonly updatedAt?: string
    }
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
      readonly ownerVersion?: string
      readonly updatedAt?: string
    }
  | {
      readonly kind: "approval" | "interaction"
      readonly ownerRef: string
      readonly ownerVersion: string
      readonly controlRef?: string
      readonly controlOwnerVersion?: string
      readonly controlUpdatedAt?: string
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
      readonly receiptState?: "pending" | "accepted" | "committed" | "rejected" | "unknown"
      readonly receiptOwnerVersion?: string
      readonly receiptCommandId?: string
      readonly receiptOperation?: string
      readonly updatedAt?: string
      readonly status: PartPayload<"approval" | "interaction">["status"]
    }
  | {
      readonly kind: "plan"
      readonly planProposalRef: string
      readonly planVersion: string
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
      readonly ownerVersion?: string
      readonly summary: string
      readonly steps: readonly { readonly stepRef: string; readonly label: string; readonly status: string }[]
      readonly status?: "proposed" | "active" | "completed" | "failed" | "canceled"
      readonly updatedAt?: string
    }
  | {
      readonly kind: "subagent"
      readonly subagentRef: string
      readonly ownerVersion?: string
      readonly status: PartPayload<"subagent">["status"]
      readonly summary?: string
      readonly updatedAt?: string
    }
  | ({ readonly kind: "media-operation" } & ChatMediaOperationOwnerState)
  | ({ readonly kind: "artifact" } & ChatArtifactOwnerState)
  | ({ readonly kind: "cost" } & ChatCostOwnerState)
  | {
      readonly kind: "notice"
      readonly noticeRef: string
      readonly ownerVersion?: string
      readonly code: string
      readonly message: string
      readonly severity: PartPayload<"notice">["severity"]
      readonly retryClass?: PartPayload<"notice">["retry_class"]
      readonly supportCorrelationRef?: string
      readonly updatedAt?: string
    }
  | {
      readonly kind: "error"
      readonly errorRef: string
      readonly ownerVersion?: string
      readonly code: string
      readonly message: string
      readonly retryClass: PartPayload<"error">["retry_class"]
      readonly supportCorrelationRef?: string
      readonly updatedAt?: string
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
  readonly presentationMessageId?: string
  readonly branchId: string
  readonly parentMessageId?: string
  readonly triggerMessageId?: string
  readonly runId: string | null
  readonly presentationRunId?: string
  readonly presentationRunBindingRef?: string
  readonly presentationMessageBindingRef?: string
  readonly presentationTextPartId?: string
  readonly presentationMessageVersion?: number
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

export type ChatPresentationRun = Readonly<{
  bindingRef: string
  presentationRunId: string
  sessionRunId: string | null
  parentPresentationRunId: string | null
  state: "starting" | "running" | "waiting" | "canceling" | "finished" | "error"
  /** Last live envelope version. Snapshot authority does not expose this per binding. */
  presentationVersion?: string
  /** Version of the optional kokoro.run.replace.v1 owner row. */
  ownerVersion?: string
}>

export type ChatPresentationControl = Readonly<{
  runBindingRef: string
  controlRef: string
  ownerRef: string
  decisionGroupRef: string
  kind: "approval" | "interaction" | "plan" | "cancellation"
  state: "pending" | "accepted" | "rejected" | "expired" | "canceled"
  ownerVersion: string
  allowedActions: readonly string[]
  updatedAt: string
}>

export type ChatPresentationReceipt = Readonly<{
  runBindingRef: string
  receiptRef: string
  controlRef: string
  ownerRef: string
  decisionGroupRef: string
  commandId: string
  operation: string
  state: "pending" | "accepted" | "committed" | "rejected" | "unknown"
  ownerVersion: string
  updatedAt: string
}>

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
  /** Browser presentation identity; never valid as a Session command Run ID. */
  readonly presentationRunId: string | null
  readonly presentationRunState: "starting" | "running" | "waiting" | "canceling" | null
  /** Authoritative presentation lineage, keyed semantically by bindingRef. */
  readonly presentationRuns: readonly ChatPresentationRun[]
  readonly presentationControls: readonly ChatPresentationControl[]
  readonly presentationReceipts: readonly ChatPresentationReceipt[]
  readonly connection: SessionConnectionState | { readonly kind: "idle" }
  readonly command: {
    readonly state: "idle" | "pending" | "conflict" | "failed"
    readonly detail?: string
  }
  readonly repair: { readonly required: boolean; readonly reason?: string }
}

export type ChatProjectionMutation =
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
    presentationRunId: null,
    presentationRunState: null,
    presentationRuns: [],
    presentationControls: [],
    presentationReceipts: [],
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
        ownerVersion: String(part.payload.expected_version),
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
        planVersion: String(part.payload.plan_version),
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

function reduceChatProjection(
  state: ChatProjection,
  action: ChatProjectionAction,
  fingerprints: PartEnvelopeFingerprints,
  envelopes: ProjectionEnvelopeAuthority,
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
        snapshotRevision: action.snapshot.snapshot_watermark.snapshot_revision_ref,
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
    case "connection":
      return { ...state, connection: copyUnknown(action.connection) as SessionConnectionState }
    case "command":
      return { ...state, command: { state: action.state, ...(action.detail ? { detail: action.detail } : {}) } }
    case "repair":
      return { ...state, repair: { required: true, reason: action.reason } }
  }
}

function presentationVersion(value: string): string | null {
  if (!/^[1-9][0-9]{0,19}$/u.test(value)) return null
  return BigInt(value) <= 18_446_744_073_709_551_615n ? value : null
}

function compareOwnerVersion(left: string, right: string): -1 | 0 | 1 {
  const leftValue = BigInt(left)
  const rightValue = BigInt(right)
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function activityIdentity(
  event: Extract<ChatAguiPresentationMutation, { type: "agui.activity" }>,
): string {
  switch (event.activityType) {
    case "kokoro.safe-summary.v1": return event.content.partRef
    case "kokoro.tool-preview.v1": return event.content.toolCallRef
    case "kokoro.hitl.v1": return event.content.ownerRef
    case "kokoro.plan.v1": return event.content.planRef
    case "kokoro.subagent.v1": return event.content.subagentRef
    case "kokoro.media.v1": return event.content.mediaOperationRef
    case "kokoro.artifact.v1": return event.content.artifactVersionRef
    case "kokoro.cost.v1": return event.content.costProjectionRef
    case "kokoro.notice.v1": return event.content.noticeRef
    case "kokoro.error.v1": return event.content.errorRef
  }
}

type AguiActivityMutation = Extract<ChatAguiPresentationMutation, { type: "agui.activity" }>

function partMatchesActivity(part: ChatPart, mutation: AguiActivityMutation): boolean {
  switch (mutation.activityType) {
    case "kokoro.safe-summary.v1": return part.kind === "reasoning-summary" && part.partRef === mutation.content.partRef
    case "kokoro.tool-preview.v1": return part.kind === "tool" && part.toolCallId === mutation.content.toolCallRef
    case "kokoro.hitl.v1": return (part.kind === "approval" || part.kind === "interaction") && part.ownerRef === mutation.content.ownerRef
    case "kokoro.plan.v1": return part.kind === "plan-progress" && part.planRef === mutation.content.planRef
    case "kokoro.subagent.v1": return part.kind === "subagent" && part.subagentRef === mutation.content.subagentRef
    case "kokoro.media.v1": return part.kind === "media-operation" && part.mediaOperationRef === mutation.content.mediaOperationRef
    case "kokoro.artifact.v1": return part.kind === "artifact" && part.artifactRef === mutation.content.artifactRef && part.artifactVersionRef === mutation.content.artifactVersionRef
    case "kokoro.cost.v1": return part.kind === "cost" && part.mediaOperationRef === mutation.content.mediaOperationRef && part.costProjectionRef === mutation.content.costProjectionRef
    case "kokoro.notice.v1": return part.kind === "notice" && part.noticeRef === mutation.content.noticeRef
    case "kokoro.error.v1": return part.kind === "error" && part.errorRef === mutation.content.errorRef
  }
}

function activityStatusLifecycle(mutation: AguiActivityMutation): MessagePartEnvelope["lifecycle"] {
  switch (mutation.activityType) {
    case "kokoro.safe-summary.v1": return mutation.content.status === "streaming" ? "streaming" : "completed"
    case "kokoro.tool-preview.v1": return ["pending", "running", "awaiting-user"].includes(mutation.content.status) ? "streaming" : "completed"
    case "kokoro.hitl.v1": return mutation.content.status === "pending" ? "streaming" : "completed"
    case "kokoro.plan.v1": return ["proposed", "active"].includes(mutation.content.status) ? "streaming" : "completed"
    case "kokoro.subagent.v1": return ["pending", "running"].includes(mutation.content.status) ? "streaming" : "completed"
    case "kokoro.media.v1": return ["completed", "partial", "failed", "canceled"].includes(mutation.content.state) ? "completed" : "streaming"
    case "kokoro.artifact.v1": return mutation.content.availability === "processing" ? "streaming" : "completed"
    case "kokoro.cost.v1": return ["pending", "estimated"].includes(mutation.content.state) ? "streaming" : "completed"
    case "kokoro.notice.v1":
    case "kokoro.error.v1": return "completed"
  }
}

function toolPreviewStatus(status: Extract<AguiActivityEvent, { activityType: "kokoro.tool-preview.v1" }>["content"]["status"]): Extract<ChatPart, { kind: "tool" }>["status"] {
  switch (status) {
    case "pending":
    case "running": return "running"
    case "awaiting-user": return "awaiting"
    case "completed": return "complete"
    case "failed": return "error"
    case "canceled": return "incomplete"
  }
}

function projectAguiActivityPart(
  mutation: AguiActivityMutation,
  current: ChatPart | undefined,
  envelopeVersion: string,
): ChatPart {
  const base = {
    id: current?.id ?? `agui.activity:${mutation.activityType}:${activityIdentity(mutation)}`,
    ordinal: current?.ordinal ?? 0,
    version: current?.version ?? 1,
    presentationVersion: envelopeVersion,
    lifecycle: activityStatusLifecycle(mutation),
  }
  switch (mutation.activityType) {
    case "kokoro.safe-summary.v1":
      return { ...base, kind: "reasoning-summary", partRef: mutation.content.partRef, text: mutation.content.summary, status: mutation.content.status, ownerVersion: mutation.content.ownerVersion, updatedAt: mutation.content.updatedAt }
    case "kokoro.tool-preview.v1":
      return {
        ...base,
        kind: "tool",
        toolCallId: mutation.content.toolCallRef,
        name: mutation.content.label,
        args: {},
        status: toolPreviewStatus(mutation.content.status),
        ...(mutation.content.resultPreview === undefined ? {} : { result: mutation.content.resultPreview }),
        ...(mutation.content.isError === undefined ? {} : { isError: mutation.content.isError }),
        ...(mutation.content.truncated === undefined ? {} : { truncated: mutation.content.truncated }),
        ownerVersion: mutation.content.ownerVersion,
        updatedAt: mutation.content.updatedAt,
      }
    case "kokoro.hitl.v1":
      return {
        ...base,
        kind: mutation.content.kind,
        ownerRef: mutation.content.ownerRef,
        ownerVersion: mutation.content.ownerVersion,
        controlRef: mutation.content.controlRef,
        decisionGroupRef: mutation.content.decisionGroupRef,
        requiredOwnerRefs: mutation.content.requiredOwnerRefs,
        title: mutation.content.title,
        description: mutation.content.description,
        allowedActions: mutation.content.allowedActions,
        status: mutation.content.status,
        ...(mutation.content.riskSummary === undefined ? {} : { riskSummary: mutation.content.riskSummary }),
        ...(mutation.content.inputSchemaRef === undefined ? {} : { inputSchemaRef: mutation.content.inputSchemaRef }),
        ...(mutation.content.deadline === undefined ? {} : { deadline: mutation.content.deadline }),
        ...(mutation.content.receiptRef === undefined ? {} : { receiptRef: mutation.content.receiptRef }),
        updatedAt: mutation.content.updatedAt,
      }
    case "kokoro.plan.v1":
      return { ...base, kind: "plan-progress", planRef: mutation.content.planRef, ownerVersion: mutation.content.ownerVersion, summary: mutation.content.summary, status: mutation.content.status, steps: mutation.content.steps, updatedAt: mutation.content.updatedAt }
    case "kokoro.subagent.v1":
      return { ...base, kind: "subagent", subagentRef: mutation.content.subagentRef, ownerVersion: mutation.content.ownerVersion, status: mutation.content.status, ...(mutation.content.summary === undefined ? {} : { summary: mutation.content.summary }), updatedAt: mutation.content.updatedAt }
    case "kokoro.media.v1":
      return { ...base, kind: "media-operation", ...projectAguiMediaOperationOwnerState(mutation.content) }
    case "kokoro.artifact.v1":
      return { ...base, kind: "artifact", ...projectAguiArtifactOwnerState(mutation.content), ...(mutation.content.title === undefined ? {} : { title: mutation.content.title }) }
    case "kokoro.cost.v1":
      return { ...base, kind: "cost", ...projectAguiCostOwnerState(mutation.content) }
    case "kokoro.notice.v1":
      return { ...base, kind: "notice", noticeRef: mutation.content.noticeRef, ownerVersion: mutation.content.ownerVersion, code: mutation.content.code, message: mutation.content.message, severity: mutation.content.severity, ...(mutation.content.retryClass === undefined ? {} : { retryClass: mutation.content.retryClass.replaceAll("-", "_") as Extract<ChatPart, { kind: "notice" }>["retryClass"] }), updatedAt: mutation.content.updatedAt }
    case "kokoro.error.v1":
      return { ...base, kind: "error", errorRef: mutation.content.errorRef, ownerVersion: mutation.content.ownerVersion, code: mutation.content.code, message: mutation.content.message, retryClass: mutation.content.retryClass.replaceAll("-", "_") as Extract<ChatPart, { kind: "error" }>["retryClass"], ...(mutation.content.supportCorrelationRef === undefined ? {} : { supportCorrelationRef: mutation.content.supportCorrelationRef }), updatedAt: mutation.content.updatedAt }
  }
}

function partOwnerVersion(part: ChatPart): string | undefined {
  return "ownerVersion" in part && typeof part.ownerVersion === "string" ? part.ownerVersion : undefined
}

function partOwnerFingerprint(part: ChatPart): string {
  return stableStringify(Object.fromEntries(Object.entries(part).filter(([key]) =>
    !["id", "ordinal", "version", "presentationVersion", "lifecycle"].includes(key))))
}

function activityTerminalState(part: ChatPart): string | undefined {
  switch (part.kind) {
    case "reasoning-summary": return part.status !== undefined && part.status !== "streaming" ? part.status : undefined
    case "tool": return ["complete", "error", "incomplete"].includes(part.status) ? part.status : undefined
    case "approval":
    case "interaction": return part.status === "pending" ? undefined : part.status
    case "plan-progress": return part.status !== undefined && ["completed", "failed", "canceled"].includes(part.status) ? part.status : undefined
    case "subagent": return ["completed", "failed", "canceled"].includes(part.status) ? part.status : undefined
    case "media-operation": return ["completed", "partial", "failed", "canceled"].includes(part.state) ? part.state : undefined
    case "artifact": return part.availability === "deleted" ? part.availability : undefined
    case "cost": return undefined
    case "notice":
    case "error": return "terminal"
    default: return undefined
  }
}

function validateAguiActivityTransition(current: ChatPart, next: ChatPart): string | undefined {
  const currentVersion = partOwnerVersion(current)
  const nextVersion = partOwnerVersion(next)
  if (currentVersion === undefined || nextVersion === undefined) return "agui_activity_owner_version_missing"
  const order = compareOwnerVersion(nextVersion, currentVersion)
  if (order < 0) return "agui_activity_owner_version_regression"
  if (order === 0 && partOwnerFingerprint(current) !== partOwnerFingerprint(next)) return "agui_activity_owner_version_conflict"
  if ("updatedAt" in current && "updatedAt" in next && typeof current.updatedAt === "string" && typeof next.updatedAt === "string" && Date.parse(next.updatedAt) < Date.parse(current.updatedAt)) {
    return "agui_activity_updated_at_regression"
  }
  if (current.kind === "media-operation" && next.kind === "media-operation") return validateMediaOperationTransition(current, next)
  if (current.kind === "artifact" && next.kind === "artifact") {
    const conflict = validateArtifactTransition(current, next)
    if (conflict !== undefined) return conflict
  }
  if (current.kind === "cost" && next.kind === "cost") {
    const conflict = validateCostTransition(current, next)
    if (conflict !== undefined) return conflict
    if (next.state === "corrected" && next.correctsOwnerVersion !== current.ownerVersion) return "cost_correction_ancestry_conflict"
  }
  const terminal = activityTerminalState(current)
  if (terminal !== undefined && activityTerminalState(next) !== terminal) return "agui_activity_terminal_regression"
  return undefined
}

function presentationMessageIndex(state: ChatProjection, messageId: string): number {
  return state.messages.findIndex((message) =>
    message.id === messageId || message.presentationMessageId === messageId)
}

function appendPresentationMessage(
  state: ChatProjection,
  mutation: Extract<ChatAguiPresentationMutation, { type: "agui.text"; phase: "start" }>,
): ChatProjection {
  if (presentationMessageIndex(state, mutation.presentationMessageId) >= 0) return state
  const branchId = state.activeBranchId
  const session = state.session
  if (
    branchId === null || session === null || mutation.runBindingRef === undefined ||
    mutation.messageBindingRef === undefined || mutation.runBinding === undefined ||
    mutation.messageBinding === undefined
  ) {
    return { ...state, repair: { required: true, reason: "agui_message_owner_missing" } }
  }
  const presentationRun = state.presentationRuns.find((run) => run.bindingRef === mutation.runBindingRef)
  if (presentationRun === undefined || ["finished", "error"].includes(presentationRun.state)) {
    return { ...state, repair: { required: true, reason: "agui_message_run_binding_missing" } }
  }
  if (
    mutation.runBinding.bindingRef !== mutation.runBindingRef ||
    mutation.runBinding.presentationRunId !== presentationRun.presentationRunId ||
    mutation.runBinding.sessionRunId !== presentationRun.sessionRunId ||
    mutation.messageBinding.bindingRef !== mutation.messageBindingRef ||
    mutation.messageBinding.presentationRunBindingRef !== mutation.runBindingRef ||
    mutation.messageBinding.presentationMessageId !== mutation.presentationMessageId ||
    (mutation.messageBinding.sessionMessageId === null) !== (mutation.messageBinding.sessionTextPartId === null)
  ) return rejectPresentation(state, "agui_message_binding_conflict")
  const branchIndex = state.branches.findIndex((branch) => branch.id === branchId)
  const branch = state.branches[branchIndex]
  if (branch === undefined) return { ...state, repair: { required: true, reason: "agui_branch_owner_missing" } }
  const sessionMessageId = mutation.messageBinding.sessionMessageId
  const sessionTextPartId = mutation.messageBinding.sessionTextPartId
  const existingIndex = sessionMessageId === null
    ? -1
    : state.messages.findIndex((message) => message.id === sessionMessageId)
  const existing = state.messages[existingIndex]
  if (existing !== undefined && existing.runId !== presentationRun.sessionRunId) {
    return rejectPresentation(state, "agui_message_session_owner_conflict")
  }
  if (existing !== undefined && existing.status !== "running") {
    return rejectPresentation(state, "agui_message_terminal_regression")
  }
  const textPart = existing?.parts.find((part) => part.id === sessionTextPartId)
  if (existing !== undefined && (sessionTextPartId === null || textPart?.kind !== "text")) {
    return rejectPresentation(state, "agui_message_text_owner_conflict")
  }
  const message: ChatProjectionMessage = {
    ...(existing ?? {
      id: sessionMessageId ?? mutation.presentationMessageId,
      role: "assistant" as const,
      createdAt: mutation.source.recordedAt,
      attachments: [],
      status: "running" as const,
    }),
    presentationMessageId: mutation.presentationMessageId,
    branchId,
    // Presentation authority has no Session run binding. Never infer one from
    // the independently projected active command run.
    runId: presentationRun.sessionRunId,
    presentationRunId: presentationRun.presentationRunId,
    presentationRunBindingRef: mutation.runBindingRef,
    presentationMessageBindingRef: mutation.messageBindingRef,
    presentationTextPartId: sessionTextPartId ?? `agui.text:${mutation.presentationMessageId}`,
    parts: existing?.parts.map((part) => part.id === sessionTextPartId
      ? { ...part, presentationVersion: mutation.source.projectionVersion }
      : part) ?? [{
        id: sessionTextPartId ?? `agui.text:${mutation.presentationMessageId}`,
        ordinal: 0,
        version: 1,
        presentationVersion: mutation.source.projectionVersion,
        lifecycle: "streaming",
        kind: "text",
        text: "",
      }],
    status: "running",
  }
  const branches = [...state.branches]
  branches[branchIndex] = {
    ...branch,
    rootMessageId: branch.rootMessageId ?? message.id,
    leafMessageId: message.id,
  }
  return {
    ...state,
    session: { ...session, activeLeafMessageId: message.id },
    branches,
    messages: existingIndex < 0
      ? [...state.messages, message]
      : state.messages.map((candidate, index) => index === existingIndex ? message : candidate),
  }
}

function withPresentationRuns(
  state: ChatProjection,
  presentationRuns: readonly ChatPresentationRun[],
): ChatProjection {
  const active = [...presentationRuns].reverse().find((run) =>
    run.state !== "finished" && run.state !== "error")
  const presentationRunState = active === undefined || active.state === "finished" || active.state === "error"
    ? null
    : active.state
  return {
    ...state,
    presentationRuns,
    presentationRunId: active?.presentationRunId ?? null,
    presentationRunState,
  }
}

type PresentationSnapshotHydration = Readonly<{
  projection: ChatProjection
  conflict?: string
}>

function hydratePresentationSnapshot(
  state: ChatProjection,
  snapshot: SessionSnapshot,
  authority: AguiPresentationSnapshotAuthority,
): PresentationSnapshotHydration {
  const sessionId = snapshot.session.session_id
  if (authority.sessionId !== sessionId) {
    return { projection: state, conflict: "agui_snapshot_session_owner_conflict" }
  }

  const runRefs = new Set<string>()
  const runIds = new Set<string>()
  const presentationRuns: ChatPresentationRun[] = []
  for (const binding of authority.runBindings) {
    if (
      binding.sessionId !== sessionId ||
      runRefs.has(binding.bindingRef) ||
      runIds.has(binding.presentationRunId)
    ) {
      return { projection: state, conflict: "agui_snapshot_run_identity_conflict" }
    }
    runRefs.add(binding.bindingRef)
    runIds.add(binding.presentationRunId)
    const sessionRun = binding.sessionRunId === null
      ? undefined
      : snapshot.runs.find((candidate) => candidate.run_id === binding.sessionRunId)
    if (
      sessionRun !== undefined &&
      ((binding.state === "open") === TERMINAL_RUN_STATUSES.has(sessionRun.execution_status))
    ) {
      return { projection: state, conflict: "agui_snapshot_run_terminal_conflict" }
    }
    presentationRuns.push({
      bindingRef: binding.bindingRef,
      presentationRunId: binding.presentationRunId,
      sessionRunId: binding.sessionRunId,
      parentPresentationRunId: binding.parentLineage.parentPresentationRunId,
      state: binding.state === "open" ? "running" : binding.state,
    })
  }
  if (authority.durableSeq !== "0" && presentationRuns.length === 0) {
    return { projection: state, conflict: "agui_snapshot_run_authority_missing" }
  }
  for (const binding of authority.runBindings) {
    const parentId = binding.parentLineage.parentPresentationRunId
    if (parentId !== null && !runIds.has(parentId)) {
      return { projection: state, conflict: "agui_snapshot_run_parent_conflict" }
    }
  }

  const messageRefs = new Set<string>()
  const presentationMessageIds = new Set<string>()
  const messagesById = new Map(state.messages.map((message) => [message.id, message]))
  const bindingsBySessionMessageId = new Map<string, typeof authority.messageBindings[number]>()
  for (const binding of authority.messageBindings) {
    if (
      binding.sessionId !== sessionId ||
      messageRefs.has(binding.bindingRef) ||
      presentationMessageIds.has(binding.presentationMessageId)
    ) {
      return { projection: state, conflict: "agui_snapshot_message_identity_conflict" }
    }
    messageRefs.add(binding.bindingRef)
    presentationMessageIds.add(binding.presentationMessageId)
    const run = presentationRuns.find((candidate) =>
      candidate.bindingRef === binding.presentationRunBindingRef)
    if (run === undefined) {
      return { projection: state, conflict: "agui_snapshot_message_run_binding_conflict" }
    }
    if ((binding.sessionMessageId === null) !== (binding.sessionTextPartId === null)) {
      return { projection: state, conflict: "agui_snapshot_message_session_owner_conflict" }
    }
    if (binding.sessionMessageId === null || binding.sessionTextPartId === null) continue
    if (bindingsBySessionMessageId.has(binding.sessionMessageId)) {
      return { projection: state, conflict: "agui_snapshot_message_identity_conflict" }
    }
    const message = messagesById.get(binding.sessionMessageId)
    if (message === undefined) {
      return { projection: state, conflict: "agui_snapshot_message_session_owner_missing" }
    }
    if (message.runId !== run.sessionRunId) {
      return { projection: state, conflict: "agui_snapshot_message_run_owner_conflict" }
    }
    const text = message.parts.find((part) => part.id === binding.sessionTextPartId)
    if (text?.kind !== "text") {
      return { projection: state, conflict: "agui_snapshot_message_text_owner_conflict" }
    }
    const textOpen = text.lifecycle === "streaming"
    if ((binding.state === "open") !== textOpen) {
      return { projection: state, conflict: "agui_snapshot_message_terminal_conflict" }
    }
    bindingsBySessionMessageId.set(binding.sessionMessageId, binding)
  }
  if (
    authority.durableSeq !== "0" &&
    state.messages.some((message) =>
      message.role === "assistant" &&
      message.status === "running" &&
      message.runId !== null &&
      !bindingsBySessionMessageId.has(message.id))
  ) {
    return { projection: state, conflict: "agui_snapshot_message_authority_missing" }
  }

  const messages = state.messages.map((message) => {
    const binding = bindingsBySessionMessageId.get(message.id)
    if (binding === undefined || binding.sessionTextPartId === null) return message
    const run = presentationRuns.find((candidate) =>
      candidate.bindingRef === binding.presentationRunBindingRef)
    if (run === undefined) return message
    return {
      ...message,
      presentationMessageId: binding.presentationMessageId,
      presentationRunId: run.presentationRunId,
      presentationRunBindingRef: run.bindingRef,
      presentationMessageBindingRef: binding.bindingRef,
      presentationTextPartId: binding.sessionTextPartId,
    }
  })
  return { projection: withPresentationRuns({ ...state, messages }, presentationRuns) }
}

function rejectPresentation(state: ChatProjection, reason: string): ChatProjection {
  return { ...state, repair: { required: true, reason } }
}

function updatePresentationMessage(
  state: ChatProjection,
  messageId: string,
  update: (message: ChatProjectionMessage) => ChatProjectionMessage,
): ChatProjection {
  const index = presentationMessageIndex(state, messageId)
  if (index < 0) return { ...state, repair: { required: true, reason: "agui_message_owner_missing" } }
  const current = state.messages[index]
  if (current === undefined) return state
  const messages = [...state.messages]
  messages[index] = update(current)
  return { ...state, messages }
}

function reducePresentation(
  state: ChatProjection,
  mutation: ChatAguiPresentationMutation,
): ChatProjection {
  if (!mutation.durable) {
    return {
      ...state,
      connection: {
        kind: "draining",
        ...(mutation.retryAfterMs === undefined ? {} : { retryAfterMs: mutation.retryAfterMs }),
      },
    }
  }
  const version = presentationVersion(mutation.source.projectionVersion)
  if (version === null) return { ...state, repair: { required: true, reason: "agui_projection_version_invalid" } }
  switch (mutation.type) {
    case "agui.lifecycle": {
      const bindingRef = mutation.runBindingRef
      if (bindingRef === undefined) return rejectPresentation(state, "agui_run_binding_missing")
      const index = state.presentationRuns.findIndex((run) => run.bindingRef === bindingRef)
      const current = state.presentationRuns[index]
      if (mutation.phase === "run-started") {
        if (
          mutation.runBinding === undefined ||
          mutation.runBinding.bindingRef !== bindingRef ||
          mutation.runBinding.presentationRunId !== mutation.runId ||
          mutation.runBinding.parentLineage.parentPresentationRunId !== (mutation.parentRunId ?? null) ||
          mutation.runBinding.sessionId !== state.session?.id
        ) return rejectPresentation(state, "agui_run_binding_conflict")
        if (current !== undefined) {
          return rejectPresentation(state, ["finished", "error"].includes(current.state)
            ? "agui_run_terminal_regression"
            : "agui_run_identity_conflict")
        }
        const parent = mutation.parentRunId === undefined
          ? undefined
          : state.presentationRuns.find((run) => run.presentationRunId === mutation.parentRunId)
        if (mutation.parentRunId !== undefined && parent === undefined) {
          return rejectPresentation(state, "agui_run_parent_missing")
        }
        return withPresentationRuns(state, [...state.presentationRuns, {
          bindingRef,
          presentationRunId: mutation.runId,
          sessionRunId: mutation.runBinding.sessionRunId,
          parentPresentationRunId: mutation.parentRunId ?? null,
          state: "running",
          presentationVersion: version,
        }])
      }
      if (current === undefined) return rejectPresentation(state, "agui_run_binding_missing")
      if (
        mutation.runBinding === undefined || mutation.runBinding.bindingRef !== bindingRef ||
        mutation.runBinding.presentationRunId !== current.presentationRunId ||
        mutation.runBinding.sessionRunId !== current.sessionRunId
      ) return rejectPresentation(state, "agui_run_binding_conflict")
      if (mutation.phase === "run-finished" && current.presentationRunId !== mutation.runId) {
        return rejectPresentation(state, "agui_run_identity_conflict")
      }
      if (current.presentationVersion !== undefined) {
        const versionOrder = compareOwnerVersion(version, current.presentationVersion)
        if (versionOrder < 0) {
          return rejectPresentation(state, "agui_run_projection_version_regression")
        }
        if (versionOrder === 0) {
          return rejectPresentation(state, "agui_run_projection_version_conflict")
        }
      }
      if (["finished", "error"].includes(current.state)) {
        return rejectPresentation(state, "agui_run_terminal_regression")
      }
      const status = mutation.phase === "run-finished" ? "complete" as const : "incomplete" as const
      const presentationRuns = [...state.presentationRuns]
      presentationRuns[index] = {
        ...current,
        state: mutation.phase === "run-finished" ? "finished" : "error",
        presentationVersion: version,
      }
      return withPresentationRuns({
        ...state,
        messages: state.messages.map((message) =>
          message.presentationRunBindingRef === bindingRef ? { ...message, status } : message),
      }, presentationRuns)
    }
    case "agui.text": {
      if (mutation.phase === "start") return appendPresentationMessage(state, mutation)
      const message = state.messages[presentationMessageIndex(state, mutation.presentationMessageId)]
      if (message === undefined) return rejectPresentation(state, "agui_message_owner_missing")
      if (
        mutation.runBindingRef === undefined || mutation.messageBindingRef === undefined ||
        message.presentationRunBindingRef !== mutation.runBindingRef ||
        message.presentationMessageBindingRef !== mutation.messageBindingRef
      ) return rejectPresentation(state, "agui_message_binding_conflict")
      if (message.status !== "running") {
        return rejectPresentation(state, "agui_message_terminal_regression")
      }
      const text = message.parts.find((part): part is Extract<ChatPart, { kind: "text" }> =>
        part.kind === "text" && part.id === message.presentationTextPartId)
      if (text === undefined) return rejectPresentation(state, "agui_message_owner_missing")
      if (text.presentationVersion !== undefined) {
        const textVersionOrder = compareOwnerVersion(version, text.presentationVersion)
        if (textVersionOrder <= 0) {
          return rejectPresentation(state, textVersionOrder < 0
            ? "agui_message_version_regression"
            : "agui_message_version_conflict")
        }
      }
      if (mutation.phase === "content") {
        return updatePresentationMessage(state, mutation.presentationMessageId, (message) => ({
          ...message,
          parts: message.parts.map((part) => part.kind === "text" && part.id === message.presentationTextPartId
            ? { ...part, text: part.text + mutation.delta, presentationVersion: version }
            : part),
        }))
      }
      return updatePresentationMessage(state, mutation.presentationMessageId, (message) => ({
        ...message,
        parts: message.parts.map((part) => part.kind === "text" && part.id === message.presentationTextPartId
          ? { ...part, lifecycle: "completed" as const, presentationVersion: version }
          : part),
        status: "complete",
      }))
    }
    case "agui.activity": {
      const owner = state.messages[presentationMessageIndex(state, mutation.presentationMessageId)]
      if (owner === undefined) return rejectPresentation(state, "agui_message_owner_missing")
      if (
        mutation.runBindingRef === undefined || mutation.messageBindingRef === undefined ||
        owner.presentationRunBindingRef !== mutation.runBindingRef ||
        owner.presentationMessageBindingRef !== mutation.messageBindingRef
      ) return rejectPresentation(state, "agui_message_binding_conflict")
      if (owner.status !== "running") return rejectPresentation(state, "agui_message_terminal_regression")
      const ownerLocations = state.messages.flatMap((message) => message.parts
        .filter((part) => partMatchesActivity(part, mutation))
        .map((part) => ({ message, part })))
      if (ownerLocations.length > 1) return rejectPresentation(state, "agui_activity_owner_ambiguous")
      const location = ownerLocations[0]
      if (location !== undefined && location.message.presentationMessageId !== owner.presentationMessageId) {
        return rejectPresentation(state, "agui_activity_owner_binding_migration")
      }
      const currentActivity = location?.part
      if (currentActivity?.presentationVersion !== undefined) {
        const envelopeOrder = compareOwnerVersion(version, currentActivity.presentationVersion)
        if (envelopeOrder <= 0) return rejectPresentation(state, envelopeOrder < 0
          ? "agui_activity_projection_version_regression"
          : "agui_activity_projection_version_conflict")
      }
      let projected: ChatPart
      try {
        projected = projectAguiActivityPart(mutation, currentActivity, version)
      } catch {
        return rejectPresentation(state, "agui_activity_projection_invalid")
      }
      if (currentActivity !== undefined) {
        const conflict = validateAguiActivityTransition(currentActivity, projected)
        if (conflict !== undefined) return rejectPresentation(state, conflict)
      }
      return updatePresentationMessage(state, mutation.presentationMessageId, (message) => {
        const existingIndex = currentActivity === undefined
          ? -1
          : message.parts.findIndex((part) => part.id === currentActivity.id)
        const part = {
          ...projected,
          ordinal: existingIndex < 0 ? message.parts.length : message.parts[existingIndex]?.ordinal ?? projected.ordinal,
        } as ChatPart
        if (existingIndex < 0) return { ...message, parts: [...message.parts, part] }
        const parts = [...message.parts]
        parts[existingIndex] = part
        return { ...message, parts }
      })
    }
    case "agui.custom": {
      switch (mutation.name) {
        case "kokoro.session.replace.v1": {
          const session = state.session
          if (session === null || session.id !== mutation.value.sessionId || mutation.value.version < session.version) {
            return { ...state, repair: { required: true, reason: "agui_session_owner_conflict" } }
          }
          return {
            ...state,
            session: {
              ...session,
              title: mutation.value.title,
              lifecycle: mutation.value.lifecycle === "deleted" ? "trashed" : mutation.value.lifecycle,
              contextPolicy: mutation.value.contextPolicy,
              version: mutation.value.version,
            },
            activeBranchId: mutation.value.activeBranchId,
          }
        }
        case "kokoro.branch.replace.v1": {
          const index = state.branches.findIndex((branch) => branch.id === mutation.value.branchId)
          const branch = state.branches[index]
          if (index < 0 || branch === undefined || mutation.value.version < branch.version) {
            return { ...state, repair: { required: true, reason: "agui_branch_owner_conflict" } }
          }
          const branches = [...state.branches]
          branches[index] = {
            ...branch,
            version: mutation.value.version,
            ...(mutation.value.rootMessageId === null ? { rootMessageId: undefined } : { rootMessageId: mutation.value.rootMessageId }),
            ...(mutation.value.leafMessageId === null ? { leafMessageId: undefined } : { leafMessageId: mutation.value.leafMessageId }),
          }
          return { ...state, branches }
        }
        case "kokoro.message.replace.v1": {
          if (mutation.value.role === "system") return state
          const current = state.messages[presentationMessageIndex(state, mutation.value.presentationMessageId)]
          if (current === undefined) return rejectPresentation(state, "agui_message_owner_missing")
          if (
            mutation.runBindingRef === undefined || mutation.messageBindingRef === undefined ||
            current.presentationRunBindingRef !== mutation.runBindingRef ||
            current.presentationMessageBindingRef !== mutation.messageBindingRef
          ) return rejectPresentation(state, "agui_message_binding_conflict")
          const nextStatus = mutation.value.lifecycle === "completed"
            ? "complete" as const
            : ["partial", "failed", "canceled"].includes(mutation.value.lifecycle)
              ? "incomplete" as const
              : "running" as const
          if (current.status !== "running" && nextStatus === "running") {
            return rejectPresentation(state, "agui_message_terminal_regression")
          }
          if (
            current.presentationMessageVersion !== undefined &&
            mutation.value.version < current.presentationMessageVersion
          ) return rejectPresentation(state, "agui_message_owner_version_regression")
          if (current.presentationMessageVersion === mutation.value.version) {
            const currentOwner = stableStringify({
              role: current.role,
              parentMessageId: current.parentMessageId ?? null,
              status: current.status,
            })
            const nextOwner = stableStringify({
              role: mutation.value.role,
              parentMessageId: mutation.value.parentPresentationMessageId,
              status: nextStatus,
            })
            if (currentOwner !== nextOwner) {
              return rejectPresentation(state, "agui_message_owner_version_conflict")
            }
          }
          const role = mutation.value.role
          return updatePresentationMessage(state, mutation.value.presentationMessageId, (message) => ({
            ...message,
            role,
            presentationMessageVersion: mutation.value.version,
            ...(mutation.value.parentPresentationMessageId === null
              ? { parentMessageId: undefined }
              : { parentMessageId: mutation.value.parentPresentationMessageId }),
            status: nextStatus,
          }))
        }
        case "kokoro.run.replace.v1": {
          const ownerVersion = presentationVersion(mutation.value.ownerVersion)
          if (ownerVersion === null) {
            return { ...state, repair: { required: true, reason: "agui_run_owner_version_invalid" } }
          }
          const bindingRef = mutation.runBindingRef
          if (bindingRef === undefined) return rejectPresentation(state, "agui_run_binding_missing")
          const index = state.presentationRuns.findIndex((run) => run.bindingRef === bindingRef)
          const current = state.presentationRuns[index]
          if (current === undefined || current.presentationRunId !== mutation.value.presentationRunId) {
            return rejectPresentation(state, "agui_run_identity_conflict")
          }
          if (current.ownerVersion !== undefined && compareOwnerVersion(ownerVersion, current.ownerVersion) < 0) {
            return rejectPresentation(state, "agui_run_owner_version_regression")
          }
          if (["finished", "error"].includes(current.state) && mutation.value.state !== current.state) {
            return rejectPresentation(state, "agui_run_terminal_regression")
          }
          if (
            current.ownerVersion !== undefined &&
            compareOwnerVersion(ownerVersion, current.ownerVersion) === 0 &&
            mutation.value.state !== current.state
          ) {
            return rejectPresentation(state, "agui_run_owner_version_conflict")
          }
          const presentationRuns = [...state.presentationRuns]
          presentationRuns[index] = { ...current, state: mutation.value.state, ownerVersion }
          return withPresentationRuns(state, presentationRuns)
        }
        case "kokoro.control.replace.v1": {
          const runBindingRef = mutation.runBindingRef
          if (runBindingRef === undefined || !state.presentationRuns.some((run) => run.bindingRef === runBindingRef)) {
            return rejectPresentation(state, "agui_control_run_binding_missing")
          }
          const currentControlIndex = state.presentationControls.findIndex((control) => control.controlRef === mutation.value.controlRef)
          const currentControl = state.presentationControls[currentControlIndex]
          const nextControl: ChatPresentationControl = { runBindingRef, ...mutation.value }
          if (currentControl !== undefined) {
            if (currentControl.runBindingRef !== runBindingRef || currentControl.ownerRef !== mutation.value.ownerRef ||
              currentControl.decisionGroupRef !== mutation.value.decisionGroupRef || currentControl.kind !== mutation.value.kind) {
              return rejectPresentation(state, "agui_control_identity_conflict")
            }
            const order = compareOwnerVersion(mutation.value.ownerVersion, currentControl.ownerVersion)
            if (order < 0) return rejectPresentation(state, "agui_control_owner_version_regression")
            if (order === 0 && stableStringify(currentControl) !== stableStringify(nextControl)) {
              return rejectPresentation(state, "agui_control_owner_version_conflict")
            }
            if (Date.parse(mutation.value.updatedAt) < Date.parse(currentControl.updatedAt)) {
              return rejectPresentation(state, "agui_control_updated_at_regression")
            }
            if (currentControl.state !== "pending" && mutation.value.state !== currentControl.state) {
              return rejectPresentation(state, "agui_control_terminal_regression")
            }
          }
          const presentationControls = [...state.presentationControls]
          if (currentControlIndex < 0) presentationControls.push(nextControl)
          else presentationControls[currentControlIndex] = nextControl
          const controlState = { ...state, presentationControls }
          const matches = state.messages.flatMap((message) => message.parts
            .filter((part): part is Extract<ChatPart, { kind: "approval" | "interaction" }> =>
              (part.kind === "approval" || part.kind === "interaction") &&
              part.controlRef === mutation.value.controlRef &&
              part.ownerRef === mutation.value.ownerRef &&
              part.decisionGroupRef === mutation.value.decisionGroupRef)
            .map((part) => ({ message, part })))
          if (mutation.value.kind === "plan" || mutation.value.kind === "cancellation") return controlState
          if (matches.length !== 1) return rejectPresentation(state, "agui_control_owner_missing")
          const match = matches[0]
          if (match === undefined || mutation.runBindingRef === undefined ||
            match.message.presentationRunBindingRef !== mutation.runBindingRef ||
            match.part.kind !== mutation.value.kind) {
            return rejectPresentation(state, "agui_control_owner_binding_conflict")
          }
          const priorVersion = match.part.controlOwnerVersion
          if (priorVersion !== undefined) {
            const order = compareOwnerVersion(mutation.value.ownerVersion, priorVersion)
            if (order < 0) return rejectPresentation(state, "agui_control_owner_version_regression")
            if (order === 0) {
              const currentFingerprint = stableStringify({
                state: match.part.status,
                allowedActions: match.part.allowedActions,
                updatedAt: match.part.controlUpdatedAt,
              })
              const nextFingerprint = stableStringify({
                state: mutation.value.state,
                allowedActions: mutation.value.allowedActions,
                updatedAt: mutation.value.updatedAt,
              })
              if (currentFingerprint !== nextFingerprint) return rejectPresentation(state, "agui_control_owner_version_conflict")
            }
            if (match.part.controlUpdatedAt !== undefined && Date.parse(mutation.value.updatedAt) < Date.parse(match.part.controlUpdatedAt)) {
              return rejectPresentation(state, "agui_control_updated_at_regression")
            }
            if (match.part.status !== "pending" && mutation.value.state !== match.part.status) {
              return rejectPresentation(state, "agui_control_terminal_regression")
            }
          }
          return updatePresentationMessage(controlState, match.message.presentationMessageId ?? match.message.id, (message) => ({
            ...message,
            parts: message.parts.map((part) => part.id === match.part.id ? {
              ...match.part,
              status: mutation.value.state,
              allowedActions: mutation.value.allowedActions,
              controlOwnerVersion: mutation.value.ownerVersion,
              controlUpdatedAt: mutation.value.updatedAt,
            } : part),
          }))
        }
        case "kokoro.receipt.replace.v1": {
          const runBindingRef = mutation.runBindingRef
          if (runBindingRef === undefined) return rejectPresentation(state, "agui_receipt_run_binding_missing")
          const control = state.presentationControls.find((candidate) => candidate.controlRef === mutation.value.controlRef)
          if (control === undefined || control.runBindingRef !== runBindingRef ||
            control.ownerRef !== mutation.value.ownerRef || control.decisionGroupRef !== mutation.value.decisionGroupRef) {
            return rejectPresentation(state, "agui_receipt_control_binding_conflict")
          }
          const currentReceiptIndex = state.presentationReceipts.findIndex((receipt) => receipt.receiptRef === mutation.value.receiptRef)
          const currentReceipt = state.presentationReceipts[currentReceiptIndex]
          const nextReceipt: ChatPresentationReceipt = { runBindingRef, ...mutation.value }
          if (currentReceipt !== undefined) {
            if (currentReceipt.runBindingRef !== runBindingRef || currentReceipt.controlRef !== mutation.value.controlRef ||
              currentReceipt.ownerRef !== mutation.value.ownerRef || currentReceipt.decisionGroupRef !== mutation.value.decisionGroupRef ||
              currentReceipt.commandId !== mutation.value.commandId || currentReceipt.operation !== mutation.value.operation) {
              return rejectPresentation(state, "agui_receipt_identity_conflict")
            }
            const order = compareOwnerVersion(mutation.value.ownerVersion, currentReceipt.ownerVersion)
            if (order < 0) return rejectPresentation(state, "agui_receipt_owner_version_regression")
            if (order === 0 && stableStringify(currentReceipt) !== stableStringify(nextReceipt)) {
              return rejectPresentation(state, "agui_receipt_owner_version_conflict")
            }
            if (Date.parse(mutation.value.updatedAt) < Date.parse(currentReceipt.updatedAt)) {
              return rejectPresentation(state, "agui_receipt_updated_at_regression")
            }
            if (["committed", "rejected"].includes(currentReceipt.state) && mutation.value.state !== currentReceipt.state) {
              return rejectPresentation(state, "agui_receipt_terminal_regression")
            }
          }
          const presentationReceipts = [...state.presentationReceipts]
          if (currentReceiptIndex < 0) presentationReceipts.push(nextReceipt)
          else presentationReceipts[currentReceiptIndex] = nextReceipt
          const receiptState = { ...state, presentationReceipts }
          const matches = state.messages.flatMap((message) => message.parts
            .filter((part): part is Extract<ChatPart, { kind: "approval" | "interaction" }> =>
              (part.kind === "approval" || part.kind === "interaction") &&
              part.controlRef === mutation.value.controlRef &&
              part.ownerRef === mutation.value.ownerRef &&
              part.decisionGroupRef === mutation.value.decisionGroupRef)
            .map((part) => ({ message, part })))
          if (control.kind === "plan" || control.kind === "cancellation") return receiptState
          if (matches.length !== 1) return rejectPresentation(state, "agui_receipt_owner_missing")
          const match = matches[0]
          if (match === undefined || mutation.runBindingRef === undefined ||
            match.message.presentationRunBindingRef !== mutation.runBindingRef ||
            match.part.controlOwnerVersion === undefined) {
            return rejectPresentation(state, "agui_receipt_control_binding_conflict")
          }
          if (match.part.receiptRef !== undefined && match.part.receiptRef !== mutation.value.receiptRef) {
            return rejectPresentation(state, "agui_receipt_identity_conflict")
          }
          const priorVersion = match.part.receiptOwnerVersion
          if (priorVersion !== undefined) {
            const order = compareOwnerVersion(mutation.value.ownerVersion, priorVersion)
            if (order < 0) return rejectPresentation(state, "agui_receipt_owner_version_regression")
            if (order === 0) {
              const currentFingerprint = stableStringify({
                receiptRef: match.part.receiptRef,
                commandId: match.part.receiptCommandId,
                operation: match.part.receiptOperation,
                state: match.part.receiptState,
              })
              const nextFingerprint = stableStringify({
                receiptRef: mutation.value.receiptRef,
                commandId: mutation.value.commandId,
                operation: mutation.value.operation,
                state: mutation.value.state,
              })
              if (currentFingerprint !== nextFingerprint) return rejectPresentation(state, "agui_receipt_owner_version_conflict")
            }
            if (["committed", "rejected"].includes(match.part.receiptState ?? "") && mutation.value.state !== match.part.receiptState) {
              return rejectPresentation(state, "agui_receipt_terminal_regression")
            }
          }
          return updatePresentationMessage(receiptState, match.message.presentationMessageId ?? match.message.id, (message) => ({
            ...message,
            parts: message.parts.map((part) => part.id === match.part.id ? {
              ...match.part,
              receiptRef: mutation.value.receiptRef,
              receiptOwnerVersion: mutation.value.ownerVersion,
              receiptCommandId: mutation.value.commandId,
              receiptOperation: mutation.value.operation,
              receiptState: mutation.value.state,
            } : part),
          }))
        }
      }
    }
  }
}

export type ChatProjectionStore = {
  readonly getSnapshot: () => ChatProjection
  readonly subscribe: (listener: () => void) => () => void
  readonly hydrate: (
    snapshot: SessionSnapshot,
    presentationAuthority: AguiPresentationSnapshotAuthority,
  ) => void
  readonly reset: () => void
  readonly dispatch: (action: ChatProjectionMutation) => void
  readonly dispatchPresentation: (mutation: ChatAguiPresentationMutation) => "applied" | "replayed" | "rejected"
}

type BranchAuthorityFence = Readonly<{
  sessionId: string
  branchId: string
  previousSessionVersion: number
  previousBranchVersion: number
  expectedLeafMessageId: string
}>

type TerminalRunAuthority = Readonly<{
  envelope: VersionedEnvelopeFingerprint<RunStatus>
  pair: RunLaunchPairBinding
}>

type TerminalLaunchAuthority = Readonly<{
  envelope: VersionedEnvelopeFingerprint<RunLaunchStatus>
  pair: RunLaunchPairBinding
}>

type SessionOwnerRecord = Readonly<{
  version: number
  identityFingerprint: string
  semanticFingerprint?: string
  projectedStateFingerprint: string
  updatedAtEpochMs: number
}>

type BranchOwnerRecord = Readonly<{
  version: number
  identityFingerprint: string
  semanticFingerprint: string
  rootMessageId: string | null
}>

type ProjectionOwnerScope = {
  sessionId: string
  sessionOwner: SessionOwnerRecord
  branchOwners: Map<string, BranchOwnerRecord>
  branchAuthorityFence: BranchAuthorityFence | null
  terminalRuns: Map<string, TerminalRunAuthority>
  terminalLaunches: Map<string, TerminalLaunchAuthority>
  terminalPairsByRunId: Map<string, RunLaunchPairBinding>
  terminalPairsByLaunchId: Map<string, RunLaunchPairBinding>
}

type HydrationOwnerConflict =
  | "session_version_regression"
  | "session_owner_version_conflict"
  | "branch_owner_missing"
  | "branch_owner_version_regression"
  | "branch_owner_version_conflict"
  | "run_terminal_authority_conflict"
  | "run_launch_terminal_authority_conflict"
  | "terminal_authority_capacity_exceeded"

const DEFAULT_TERMINAL_AUTHORITY_LIMIT = 4_096

function ownerTimestamp(value: string): number {
  return Date.parse(value)
}

function sessionProjectedStateFingerprint(
  session: Pick<ChatSessionMetadata, "id" | "projectRef" | "title" | "lifecycle" | "contextPolicy" | "version" | "activeLeafMessageId">,
  activeBranchId: string,
): string {
  return stableStringify({
    id: session.id,
    projectRef: session.projectRef,
    title: session.title,
    lifecycle: session.lifecycle,
    contextPolicy: session.contextPolicy,
    version: session.version,
    activeBranchId,
    activeLeafMessageId: session.activeLeafMessageId ?? null,
  })
}

function sessionOwnerRecordFromSnapshot(session: SessionSnapshot["session"]): SessionOwnerRecord {
  const projected = projectSessionMetadata(session)
  return {
    version: session.version,
    identityFingerprint: stableStringify({
      id: session.session_id,
      projectRef: session.project_ref,
      contextPolicy: session.context_policy,
      createdAtEpochMs: ownerTimestamp(session.created_at),
    }),
    semanticFingerprint: stableStringify({
      id: session.session_id,
      projectRef: session.project_ref,
      title: session.title,
      lifecycle: session.lifecycle,
      contextPolicy: session.context_policy,
      activeBranchId: session.active_branch_id,
      activeLeafMessageId: session.active_leaf_message_id ?? null,
      version: session.version,
      createdAtEpochMs: ownerTimestamp(session.created_at),
      updatedAtEpochMs: ownerTimestamp(session.updated_at),
    }),
    projectedStateFingerprint: sessionProjectedStateFingerprint(projected, session.active_branch_id),
    updatedAtEpochMs: ownerTimestamp(session.updated_at),
  }
}

function branchOwnerRecord(branch: ConversationBranch): BranchOwnerRecord {
  return {
    version: branch.version,
    identityFingerprint: stableStringify({
      id: branch.branch_id,
      parentBranchId: branch.parent_branch_id ?? null,
      forkedFromMessageId: branch.forked_from_message_id ?? null,
      origin: branch.origin,
      createdAtEpochMs: ownerTimestamp(branch.created_at),
    }),
    semanticFingerprint: stableStringify({
      id: branch.branch_id,
      parentBranchId: branch.parent_branch_id ?? null,
      forkedFromMessageId: branch.forked_from_message_id ?? null,
      rootMessageId: branch.root_message_id ?? null,
      leafMessageId: branch.leaf_message_id ?? null,
      origin: branch.origin,
      version: branch.version,
      createdAtEpochMs: ownerTimestamp(branch.created_at),
    }),
    rootMessageId: branch.root_message_id ?? null,
  }
}

function sessionOwnerConflict(
  current: SessionOwnerRecord,
  candidate: SessionOwnerRecord,
): HydrationOwnerConflict | undefined {
  if (candidate.version < current.version) return "session_version_regression"
  if (
    candidate.identityFingerprint !== current.identityFingerprint ||
    candidate.updatedAtEpochMs < current.updatedAtEpochMs
  ) return "session_owner_version_conflict"
  if (candidate.version !== current.version) return undefined
  if (current.semanticFingerprint !== undefined) {
    if (candidate.semanticFingerprint !== current.semanticFingerprint) return "session_owner_version_conflict"
  } else if (candidate.projectedStateFingerprint !== current.projectedStateFingerprint) {
    return "session_owner_version_conflict"
  }
  return undefined
}

function branchOwnerConflict(
  current: BranchOwnerRecord,
  candidate: BranchOwnerRecord,
): HydrationOwnerConflict | undefined {
  if (candidate.version < current.version) return "branch_owner_version_regression"
  if (candidate.identityFingerprint !== current.identityFingerprint) return "branch_owner_version_conflict"
  if (candidate.version === current.version && candidate.semanticFingerprint !== current.semanticFingerprint) {
    return "branch_owner_version_conflict"
  }
  if (
    candidate.version > current.version &&
    current.rootMessageId !== null &&
    candidate.rootMessageId !== current.rootMessageId
  ) return "branch_owner_version_conflict"
  return undefined
}

function samePair(left: RunLaunchPairBinding, right: RunLaunchPairBinding): boolean {
  return left.runId === right.runId && left.launchId === right.launchId && left.branchId === right.branchId
}

function terminalEnvelopeConflicts<Status extends string>(
  terminal: VersionedEnvelopeFingerprint<Status>,
  candidate: VersionedEnvelopeFingerprint<Status>,
): boolean {
  if (candidate.bindingFingerprint !== terminal.bindingFingerprint) return true
  if (candidate.version < terminal.version || candidate.status !== terminal.status) return true
  return candidate.version === terminal.version && candidate.fingerprint !== terminal.fingerprint
}

function terminalPairConflict(
  scope: ProjectionOwnerScope,
  pair: RunLaunchPairBinding,
): HydrationOwnerConflict | undefined {
  const byRun = scope.terminalPairsByRunId.get(pair.runId)
  if (byRun !== undefined && !samePair(byRun, pair)) {
    return scope.terminalRuns.has(byRun.runId)
      ? "run_terminal_authority_conflict"
      : "run_launch_terminal_authority_conflict"
  }
  const byLaunch = scope.terminalPairsByLaunchId.get(pair.launchId)
  if (byLaunch !== undefined && !samePair(byLaunch, pair)) {
    return scope.terminalRuns.has(byLaunch.runId)
      ? "run_terminal_authority_conflict"
      : "run_launch_terminal_authority_conflict"
  }
  return undefined
}

function snapshotOwnerConflict(
  scope: ProjectionOwnerScope,
  snapshot: SessionSnapshot,
): HydrationOwnerConflict | undefined {
  const sessionConflict = sessionOwnerConflict(
    scope.sessionOwner,
    sessionOwnerRecordFromSnapshot(snapshot.session),
  )
  if (sessionConflict !== undefined) return sessionConflict
  for (const [branchId, current] of scope.branchOwners) {
    const branch = snapshot.branches.find((candidate) => candidate.branch_id === branchId)
    if (branch === undefined) return "branch_owner_missing"
    const branchConflict = branchOwnerConflict(current, branchOwnerRecord(branch))
    if (branchConflict !== undefined) return branchConflict
  }
  return undefined
}

function hydrationOwnerConflict(
  scope: ProjectionOwnerScope,
  authority: ProjectionEnvelopeAuthority,
): HydrationOwnerConflict | undefined {
  for (const pair of authority.pairsByRunId.values()) {
    const pairConflict = terminalPairConflict(scope, pair)
    if (pairConflict !== undefined) return pairConflict
  }
  for (const [runId, terminal] of scope.terminalRuns) {
    const candidateRun = authority.runs.get(runId)
    if (candidateRun !== undefined && terminalEnvelopeConflicts(terminal.envelope, candidateRun)) {
      return "run_terminal_authority_conflict"
    }
    const candidateLaunch = authority.launches.get(terminal.pair.launchId)
    const candidatePair = authority.pairsByLaunchId.get(terminal.pair.launchId)
    if (
      candidateLaunch !== undefined &&
      (candidatePair === undefined || !samePair(candidatePair, terminal.pair) ||
        candidateRun === undefined && !TERMINAL_LAUNCH_STATUSES.has(candidateLaunch.status))
    ) {
      return "run_terminal_authority_conflict"
    }
  }
  for (const [launchId, terminal] of scope.terminalLaunches) {
    const candidateLaunch = authority.launches.get(launchId)
    if (candidateLaunch !== undefined && terminalEnvelopeConflicts(terminal.envelope, candidateLaunch)) {
      return "run_launch_terminal_authority_conflict"
    }
    const candidateRun = authority.runs.get(terminal.pair.runId)
    const candidatePair = authority.pairsByRunId.get(terminal.pair.runId)
    if (
      candidateRun !== undefined &&
      (candidatePair === undefined || !samePair(candidatePair, terminal.pair) ||
        !TERMINAL_RUN_STATUSES.has(candidateRun.status))
    ) {
      return "run_launch_terminal_authority_conflict"
    }
  }
  return undefined
}

function terminalAuthorityCapacityExceeded(
  scope: ProjectionOwnerScope | null,
  authority: ProjectionEnvelopeAuthority,
  limit: number,
): boolean {
  const runIds = new Set(scope?.terminalRuns.keys() ?? [])
  const launchIds = new Set(scope?.terminalLaunches.keys() ?? [])
  for (const [runId, envelope] of authority.runs) {
    if (TERMINAL_RUN_STATUSES.has(envelope.status)) runIds.add(runId)
  }
  for (const [launchId, envelope] of authority.launches) {
    if (TERMINAL_LAUNCH_STATUSES.has(envelope.status)) launchIds.add(launchId)
  }
  return runIds.size + launchIds.size > limit
}

function rememberTerminalAuthority(
  scope: ProjectionOwnerScope,
  authority: ProjectionEnvelopeAuthority,
): void {
  for (const [runId, envelope] of authority.runs) {
    if (!TERMINAL_RUN_STATUSES.has(envelope.status)) continue
    const pair = authority.pairsByRunId.get(runId)
    const current = scope.terminalRuns.get(runId)
    if (
      pair !== undefined &&
      (current === undefined || !terminalEnvelopeConflicts(current.envelope, envelope))
    ) {
      scope.terminalRuns.set(runId, { envelope, pair })
      scope.terminalPairsByRunId.set(pair.runId, pair)
      scope.terminalPairsByLaunchId.set(pair.launchId, pair)
    }
  }
  for (const [launchId, envelope] of authority.launches) {
    if (!TERMINAL_LAUNCH_STATUSES.has(envelope.status)) continue
    const pair = authority.pairsByLaunchId.get(launchId)
    const current = scope.terminalLaunches.get(launchId)
    if (
      pair !== undefined &&
      (current === undefined || !terminalEnvelopeConflicts(current.envelope, envelope))
    ) {
      scope.terminalLaunches.set(launchId, { envelope, pair })
      scope.terminalPairsByRunId.set(pair.runId, pair)
      scope.terminalPairsByLaunchId.set(pair.launchId, pair)
    }
  }
}

function createProjectionOwnerScope(
  snapshot: SessionSnapshot,
  authority: ProjectionEnvelopeAuthority,
): ProjectionOwnerScope {
  const scope: ProjectionOwnerScope = {
    sessionId: snapshot.session.session_id,
    sessionOwner: sessionOwnerRecordFromSnapshot(snapshot.session),
    branchOwners: new Map(snapshot.branches.map((branch) => [branch.branch_id, branchOwnerRecord(branch)])),
    branchAuthorityFence: null,
    terminalRuns: new Map(),
    terminalLaunches: new Map(),
    terminalPairsByRunId: new Map(),
    terminalPairsByLaunchId: new Map(),
  }
  rememberTerminalAuthority(scope, authority)
  return scope
}

export type ChatProjectionStoreOptions = Readonly<{
  terminalAuthorityLimit?: number
}>

export function createChatProjectionStore(options: ChatProjectionStoreOptions = {}): ChatProjectionStore {
  const terminalAuthorityLimit = options.terminalAuthorityLimit ?? DEFAULT_TERMINAL_AUTHORITY_LIMIT
  if (!Number.isSafeInteger(terminalAuthorityLimit) || terminalAuthorityLimit < 1) {
    throw new RangeError("terminalAuthorityLimit must be a positive safe integer")
  }
  let state = createChatProjection()
  let fingerprints: PartEnvelopeFingerprints = new WeakMap()
  let envelopes = emptyEnvelopeAuthority()
  let ownerScope: ProjectionOwnerScope | null = null
  const presentationReceipts = new Map<string, string>()
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
    hydrate(snapshot, presentationAuthority) {
      const currentScope = ownerScope?.sessionId === snapshot.session.session_id ? ownerScope : null
      const nextFingerprints: PartEnvelopeFingerprints = new WeakMap()
      const nextEnvelopes = snapshotEnvelopeAuthority(snapshot)
      let next = reduceChatProjection(
        state,
        { type: "snapshot", snapshot },
        nextFingerprints,
        nextEnvelopes.authority,
      )
      const built = buildProjectionIndexes(next.messages)
      const conflict = nextEnvelopes.conflict ?? built.conflict
      if (conflict !== undefined) {
        next = { ...next, repair: { required: true, reason: conflict } }
      }
      if (!next.repair.required) {
        const presentation = hydratePresentationSnapshot(next, snapshot, presentationAuthority)
        next = presentation.projection
        if (presentation.conflict !== undefined) {
          next = { ...next, repair: { required: true, reason: presentation.conflict } }
        }
      }
      let ownerConflict: HydrationOwnerConflict | undefined
      if (currentScope !== null) {
        ownerConflict = snapshotOwnerConflict(currentScope, snapshot) ??
          hydrationOwnerConflict(currentScope, nextEnvelopes.authority)
      }
      if (
        ownerConflict === undefined &&
        terminalAuthorityCapacityExceeded(currentScope, nextEnvelopes.authority, terminalAuthorityLimit)
      ) {
        ownerConflict = "terminal_authority_capacity_exceeded"
      }
      const fence = currentScope?.branchAuthorityFence ?? null
      let clearsFence = false
      if (ownerConflict === undefined && currentScope !== null && fence !== null) {
        const fencedBranch = snapshot.branches.find((branch) => branch.branch_id === fence.branchId)
        const fencedLeaf = next.messages.at(-1)
        const replacesSameBranchAuthority =
          !next.repair.required &&
          snapshot.session.active_branch_id === fence.branchId &&
          snapshot.session.version > fence.previousSessionVersion &&
          snapshot.session.active_leaf_message_id === fence.expectedLeafMessageId &&
          fencedBranch?.leaf_message_id === fence.expectedLeafMessageId &&
          fencedBranch.version > fence.previousBranchVersion &&
          fencedLeaf?.id === fence.expectedLeafMessageId
        const replacesWithNewActiveBranch =
          !next.repair.required &&
          snapshot.session.active_branch_id !== fence.branchId &&
          snapshot.session.version > fence.previousSessionVersion
        if (replacesSameBranchAuthority || replacesWithNewActiveBranch) {
          clearsFence = true
        } else if (!next.repair.required) {
          next = { ...next, repair: { required: true, reason: "active_branch_authority_stale" } }
        }
      }
      const rejection = ownerConflict ?? (next.repair.required ? next.repair.reason ?? "snapshot_invalid" : undefined)
      if (rejection !== undefined) {
        const rejected = { ...state, repair: { required: true, reason: rejection } }
        commit(ownerScope === null ? { ...next, repair: rejected.repair } : rejected)
        return
      }
      presentationReceipts.clear()
      fingerprints = nextFingerprints
      envelopes = nextEnvelopes.authority
      if (currentScope === null) {
        ownerScope = createProjectionOwnerScope(snapshot, nextEnvelopes.authority)
      } else {
        currentScope.sessionOwner = sessionOwnerRecordFromSnapshot(snapshot.session)
        for (const branch of snapshot.branches) {
          currentScope.branchOwners.set(branch.branch_id, branchOwnerRecord(branch))
        }
        if (clearsFence) currentScope.branchAuthorityFence = null
        rememberTerminalAuthority(currentScope, nextEnvelopes.authority)
      }
      commit(next)
    },
    reset() {
      fingerprints = new WeakMap()
      envelopes = emptyEnvelopeAuthority()
      const next = createChatProjection()
      presentationReceipts.clear()
      commit(next)
    },
    dispatch(action) {
      commit(reduceChatProjection(state, action, fingerprints, envelopes))
    },
    dispatchPresentation(mutation) {
      if (!mutation.durable) {
        commit(reducePresentation(state, mutation))
        return "applied"
      }
      if (state.repair.required) return "rejected"
      const fingerprint = stableStringify(mutation)
      const existing = presentationReceipts.get(mutation.cursor)
      if (existing !== undefined) {
        if (existing !== fingerprint) {
          commit({ ...state, repair: { required: true, reason: "agui_cursor_identity_conflict" } })
          return "rejected"
        }
        return "replayed"
      }
      const next = reducePresentation(state, mutation)
      if (next.repair.required) {
        commit(next)
        return "rejected"
      }
      presentationReceipts.set(mutation.cursor, fingerprint)
      commit(next)
      return "applied"
    },
  }
}
