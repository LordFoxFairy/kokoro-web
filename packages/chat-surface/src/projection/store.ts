import type { SessionConnectionState } from "@kokoro/session-client"
import type { AguiActivityEvent } from "@kokoro/session-client/agui-presentation"
import stableStringify from "fast-json-stable-stringify"
import type {
  ConversationBranch,
  MessagePartEnvelope,
  MessageRecord,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"

import {
  projectArtifactOwnerState,
  projectCostOwnerState,
  projectMediaOperationOwnerState,
  type ChatArtifactOwnerState,
  type ChatCostOwnerState,
  type ChatMediaOperationOwnerState,
} from "./owner-state.js"
import type { ChatAguiPresentationMutation } from "../runtime/agui-presentation-adapter.js"

type ChatPartBase = {
  readonly id: string
  readonly ordinal: number
  readonly version: number
  readonly lifecycle: MessagePartEnvelope["lifecycle"]
}

type ChatActivityPart<Event extends AguiActivityEvent = AguiActivityEvent> =
  Event extends AguiActivityEvent
    ? ChatPartBase & Readonly<{
        kind: "activity"
        activityType: Event["activityType"]
        content: Event["content"]
        replace: true
      }>
    : never

type PartPayload<Kind extends MessagePartEnvelope["kind"]> =
  Extract<MessagePartEnvelope, { readonly kind: Kind }>["payload"]

export type ChatPart = ChatPartBase & (
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "reasoning-summary"; readonly partRef: string; readonly text: string }
  | ChatActivityPart
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
  readonly presentationRunId?: string
  readonly presentationRunBindingRef?: string
  readonly presentationMessageBindingRef?: string
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
  parentPresentationRunId: string | null
  state: "starting" | "running" | "waiting" | "canceling" | "finished" | "error"
  ownerVersion: number
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

function presentationVersion(value: string): number | null {
  const version = Number(value)
  return Number.isSafeInteger(version) && version > 0 ? version : null
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
    case "kokoro.media.v1": return event.content.operationRef
    case "kokoro.artifact.v1": return event.content.artifactVersionRef
    case "kokoro.cost.v1": return event.content.costProjectionRef
    case "kokoro.notice.v1": return event.content.noticeRef
    case "kokoro.error.v1": return event.content.errorRef
  }
}

function presentationMessageIndex(state: ChatProjection, messageId: string): number {
  return state.messages.findIndex((message) => message.id === messageId)
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
    mutation.messageBindingRef === undefined
  ) {
    return { ...state, repair: { required: true, reason: "agui_message_owner_missing" } }
  }
  const presentationRun = state.presentationRuns.find((run) => run.bindingRef === mutation.runBindingRef)
  if (presentationRun === undefined || ["finished", "error"].includes(presentationRun.state)) {
    return { ...state, repair: { required: true, reason: "agui_message_run_binding_missing" } }
  }
  const branchIndex = state.branches.findIndex((branch) => branch.id === branchId)
  const branch = state.branches[branchIndex]
  if (branch === undefined) return { ...state, repair: { required: true, reason: "agui_branch_owner_missing" } }
  const message: ChatProjectionMessage = {
    id: mutation.presentationMessageId,
    branchId,
    // Presentation authority has no Session run binding. Never infer one from
    // the independently projected active command run.
    runId: null,
    presentationRunId: presentationRun.presentationRunId,
    presentationRunBindingRef: mutation.runBindingRef,
    presentationMessageBindingRef: mutation.messageBindingRef,
    role: "assistant",
    createdAt: mutation.source.recordedAt,
    parts: [{
      id: `agui.text:${mutation.presentationMessageId}`,
      ordinal: 0,
      version: presentationVersion(mutation.source.projectionVersion) ?? 1,
      lifecycle: "streaming",
      kind: "text",
      text: "",
    }],
    attachments: [],
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
    messages: [...state.messages, message],
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
          parentPresentationRunId: mutation.parentRunId ?? null,
          state: "running",
          ownerVersion: version,
        }])
      }
      if (current === undefined) return rejectPresentation(state, "agui_run_binding_missing")
      if (mutation.phase === "run-finished" && current.presentationRunId !== mutation.runId) {
        return rejectPresentation(state, "agui_run_identity_conflict")
      }
      if (version < current.ownerVersion) {
        return rejectPresentation(state, "agui_run_owner_version_regression")
      }
      if (version === current.ownerVersion) {
        return rejectPresentation(state, "agui_run_owner_version_conflict")
      }
      if (["finished", "error"].includes(current.state)) {
        return rejectPresentation(state, "agui_run_terminal_regression")
      }
      const status = mutation.phase === "run-finished" ? "complete" as const : "incomplete" as const
      const presentationRuns = [...state.presentationRuns]
      presentationRuns[index] = {
        ...current,
        state: mutation.phase === "run-finished" ? "finished" : "error",
        ownerVersion: version,
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
      const text = message.parts.find((part): part is Extract<ChatPart, { kind: "text" }> => part.kind === "text")
      if (text === undefined) return rejectPresentation(state, "agui_message_owner_missing")
      if (version <= text.version) {
        return rejectPresentation(state, version < text.version
          ? "agui_message_version_regression"
          : "agui_message_version_conflict")
      }
      if (mutation.phase === "content") {
        return updatePresentationMessage(state, mutation.presentationMessageId, (message) => ({
          ...message,
          parts: message.parts.map((part) => part.kind === "text"
            ? { ...part, text: part.text + mutation.delta, version }
            : part),
        }))
      }
      return updatePresentationMessage(state, mutation.presentationMessageId, (message) => ({
        ...message,
        parts: message.parts.map((part) => part.kind === "text"
          ? { ...part, lifecycle: "completed" as const, version }
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
      const activityId = `agui.activity:${mutation.activityType}:${activityIdentity(mutation)}`
      const currentActivity = owner.parts.find((part) => part.id === activityId)
      if (currentActivity !== undefined && version <= currentActivity.version) {
        return rejectPresentation(state, version < currentActivity.version
          ? "agui_activity_version_regression"
          : "agui_activity_version_conflict")
      }
      return updatePresentationMessage(state, mutation.presentationMessageId, (message) => {
        const id = activityId
        const existingIndex = message.parts.findIndex((part) => part.id === id)
        const part: ChatActivityPart = {
          id,
          ordinal: existingIndex < 0 ? message.parts.length : message.parts[existingIndex]?.ordinal ?? 0,
          version,
          lifecycle: "streaming",
          kind: "activity",
          activityType: mutation.activityType,
          content: mutation.content,
          replace: true,
        } as ChatActivityPart
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
          const role = mutation.value.role
          return updatePresentationMessage(state, mutation.value.presentationMessageId, (message) => ({
            ...message,
            role,
            ...(mutation.value.parentPresentationMessageId === null
              ? { parentMessageId: undefined }
              : { parentMessageId: mutation.value.parentPresentationMessageId }),
            status: ["completed"].includes(mutation.value.lifecycle)
              ? "complete"
              : ["partial", "failed", "canceled"].includes(mutation.value.lifecycle)
                ? "incomplete"
                : "running",
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
          if (ownerVersion < current.ownerVersion) {
            return rejectPresentation(state, "agui_run_owner_version_regression")
          }
          if (["finished", "error"].includes(current.state) && mutation.value.state !== current.state) {
            return rejectPresentation(state, "agui_run_terminal_regression")
          }
          if (ownerVersion === current.ownerVersion && mutation.value.state !== current.state) {
            return rejectPresentation(state, "agui_run_owner_version_conflict")
          }
          const presentationRuns = [...state.presentationRuns]
          presentationRuns[index] = { ...current, state: mutation.value.state, ownerVersion }
          return withPresentationRuns(state, presentationRuns)
        }
        case "kokoro.control.replace.v1":
        case "kokoro.receipt.replace.v1":
          return state
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
    hydrate(snapshot) {
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
