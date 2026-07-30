// GENERATED — DO NOT EDIT. Source: contract/spec/http.yaml
// Regenerate: python3 contract/generate.py

import { z } from "zod"

export const sessionHttpContractMetadata = Object.freeze({
  schemaId: "kokoro.session.browser.v3",
  schemaVersion: 3,
  sourceDigestSha256: "5e550086f0a7478ff839ffee87f377a64a12077e9fc8b8e5df6f512385f1f687",
})

export const commandIdentitySchema = z
  .object({
    command_id: z.string().min(1).max(128),
    idempotency_key: z.string().min(1).max(191),
    digest_algorithm: z.literal("SHA256_CANONICAL_JSON_V2"),
    request_digest: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
export type CommandIdentity = z.infer<typeof commandIdentitySchema>

export const errorDetailSchema = z
  .object({
    code: z.enum(["REQUEST_INVALID", "PAYLOAD_TOO_LARGE", "METHOD_NOT_ALLOWED", "UNSUPPORTED_MEDIA_TYPE", "BFF_WORKLOAD_REQUIRED", "BFF_WORKLOAD_REVOKED", "SESSION_ACCESS_GRANT_REQUIRED", "SESSION_ACCESS_GRANT_EXPIRED", "SESSION_ACCESS_GRANT_REVOKED", "SESSION_SCOPE_MISMATCH", "SESSION_NOT_FOUND", "SESSION_VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "ACTIVE_RUN_EXISTS", "CAPABILITY_SNAPSHOT_LOCKED", "MODEL_OPTION_UNAVAILABLE", "ATTACHMENT_NOT_READY", "ATTACHMENT_REVOKED", "ADMISSION_DENIED", "ADMISSION_OUTCOME_UNKNOWN", "LAUNCH_OUTCOME_UNKNOWN", "RUN_CANCELLATION_PENDING", "RUN_OUTCOME_UNKNOWN", "ACTION_NOT_FOUND", "ACTION_VERSION_CONFLICT", "ACTION_EXPIRED", "ACTION_NOT_ALLOWED", "ACTION_DECISION_PENDING", "PLAN_NOT_FOUND", "PLAN_VERSION_CONFLICT", "PLAN_EXPIRED", "PLAN_DECISION_PENDING", "CURSOR_INVALID", "CURSOR_CONFLICT", "CURSOR_AHEAD", "SNAPSHOT_REQUIRED", "CURSOR_SCOPE_MISMATCH", "STREAM_EPOCH_MISMATCH", "CLIENT_CONTRACT_UPGRADE_REQUIRED", "PART_SCHEMA_UNSUPPORTED", "INTERNAL_UNAVAILABLE"]),
    message: z.string().min(1),
    retry_class: z.enum(["never", "immediate", "after_delay", "after_user_action", "reconcile_receipt"]),
    action: z.enum(["retry_same_cursor", "refresh_grant", "reauthenticate", "refetch_snapshot", "upgrade_client", "stop", "developer_error", "wait_or_cancel", "fork_new_session", "choose_model", "wait_prerequisite", "remove_attachment", "show_reason", "reconcile_receipt", "poll_or_stream", "render_unsupported"]),
    details: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type ErrorDetail = z.infer<typeof errorDetailSchema>

export const errorEnvelopeSchema = z
  .object({
    error: errorDetailSchema,
    request_id: z.string().min(1),
    correlation_id: z.string().min(1),
  })
  .strict()
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>

export const sessionCreatedCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    initial_branch_id: z.string().min(1),
    session_version: z.number().int().positive(),
  })
  .strict()
export type SessionCreatedCommandResult = z.infer<typeof sessionCreatedCommandResultSchema>

export const runLaunchCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    branch_id: z.string().min(1),
    trigger_message_id: z.string().min(1),
    assistant_message_id: z.string().min(1),
    launch_id: z.string().min(1),
    proposed_run_id: z.string().min(1),
    session_version: z.number().int().positive(),
    branch_version: z.number().int().positive(),
  })
  .strict()
export type RunLaunchCommandResult = z.infer<typeof runLaunchCommandResultSchema>

export const branchCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    branch_id: z.string().min(1),
    active_leaf_message_id: z.string().min(1).nullable(),
    session_version: z.number().int().positive(),
    branch_version: z.number().int().positive(),
  })
  .strict()
export type BranchCommandResult = z.infer<typeof branchCommandResultSchema>

export const cancellationCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    decision_id: z.string().min(1),
    run_projection_version: z.number().int().positive(),
  })
  .strict()
export type CancellationCommandResult = z.infer<typeof cancellationCommandResultSchema>

export const actionDecisionCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    decision_id: z.string().min(1),
    owner_kind: z.enum(["approval", "interaction"]),
    owner_ref: z.string().min(1),
    owner_version: z.number().int().positive(),
    control_status: z.enum(["pending", "persisted", "applied", "failed", "outcome_unknown"]),
  })
  .strict()
export type ActionDecisionCommandResult = z.infer<typeof actionDecisionCommandResultSchema>

export const planDecisionCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    decision_id: z.string().min(1),
    plan_proposal_ref: z.string().min(1),
    plan_version: z.number().int().positive(),
    control_status: z.enum(["pending", "persisted", "applied", "failed", "outcome_unknown"]),
  })
  .strict()
export type PlanDecisionCommandResult = z.infer<typeof planDecisionCommandResultSchema>

export const sessionMutationCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    session_version: z.number().int().positive(),
    lifecycle: z.enum(["active", "archived", "trashed"]),
  })
  .strict()
export type SessionMutationCommandResult = z.infer<typeof sessionMutationCommandResultSchema>

export const folderUpdatedCommandResultSchema = z
  .object({
    folder_id: z.string().min(1),
    project_ref: z.string().min(1),
    folder_version: z.number().int().positive(),
  })
  .strict()
export type FolderUpdatedCommandResult = z.infer<typeof folderUpdatedCommandResultSchema>

export const folderDeletedCommandResultSchema = z
  .object({
    folder_id: z.string().min(1),
    project_ref: z.string().min(1),
  })
  .strict()
export type FolderDeletedCommandResult = z.infer<typeof folderDeletedCommandResultSchema>

export const preferenceCommandResultSchema = z
  .object({
    session_id: z.string().min(1),
    pinned: z.boolean(),
    folder_id: z.string().min(1).nullable(),
    preference_version: z.number().int().positive(),
  })
  .strict()
export type PreferenceCommandResult = z.infer<typeof preferenceCommandResultSchema>

const sessionCommandEffectSessionCreatedSchema = z
  .object({
    kind: z.literal("session-created"),
    payload: sessionCreatedCommandResultSchema,
  })
  .strict()

const sessionCommandEffectRunLaunchCreatedSchema = z
  .object({
    kind: z.literal("run-launch-created"),
    payload: runLaunchCommandResultSchema,
  })
  .strict()

const sessionCommandEffectBranchUpdatedSchema = z
  .object({
    kind: z.literal("branch-updated"),
    payload: branchCommandResultSchema,
  })
  .strict()

const sessionCommandEffectCancellationRequestedSchema = z
  .object({
    kind: z.literal("cancellation-requested"),
    payload: cancellationCommandResultSchema,
  })
  .strict()

const sessionCommandEffectActionDecisionRecordedSchema = z
  .object({
    kind: z.literal("action-decision-recorded"),
    payload: actionDecisionCommandResultSchema,
  })
  .strict()

const sessionCommandEffectPlanDecisionRecordedSchema = z
  .object({
    kind: z.literal("plan-decision-recorded"),
    payload: planDecisionCommandResultSchema,
  })
  .strict()

const sessionCommandEffectSessionUpdatedSchema = z
  .object({
    kind: z.literal("session-updated"),
    payload: sessionMutationCommandResultSchema,
  })
  .strict()

const sessionCommandEffectPreferenceUpdatedSchema = z
  .object({
    kind: z.literal("preference-updated"),
    payload: preferenceCommandResultSchema,
  })
  .strict()

const sessionCommandEffectFolderUpdatedSchema = z
  .object({
    kind: z.literal("folder-updated"),
    payload: folderUpdatedCommandResultSchema,
  })
  .strict()

const sessionCommandEffectFolderDeletedSchema = z
  .object({
    kind: z.literal("folder-deleted"),
    payload: folderDeletedCommandResultSchema,
  })
  .strict()

export const sessionCommandEffectSchema = z.discriminatedUnion("kind", [
  sessionCommandEffectSessionCreatedSchema,
  sessionCommandEffectRunLaunchCreatedSchema,
  sessionCommandEffectBranchUpdatedSchema,
  sessionCommandEffectCancellationRequestedSchema,
  sessionCommandEffectActionDecisionRecordedSchema,
  sessionCommandEffectPlanDecisionRecordedSchema,
  sessionCommandEffectSessionUpdatedSchema,
  sessionCommandEffectPreferenceUpdatedSchema,
  sessionCommandEffectFolderUpdatedSchema,
  sessionCommandEffectFolderDeletedSchema,
])
export type SessionCommandEffect = z.infer<typeof sessionCommandEffectSchema>

export const commandRecoveryPayloadSchema = z
  .object({
    retry_class: z.enum(["never", "immediate", "after_delay", "after_user_action", "reconcile_receipt"]),
    action: z.enum(["retry_same_cursor", "refresh_grant", "reauthenticate", "refetch_snapshot", "upgrade_client", "stop", "developer_error", "wait_or_cancel", "fork_new_session", "choose_model", "wait_prerequisite", "remove_attachment", "show_reason", "reconcile_receipt", "poll_or_stream", "render_unsupported"]),
    retry_after_ms: z.number().int().nonnegative().optional(),
  })
  .strict()
export type CommandRecoveryPayload = z.infer<typeof commandRecoveryPayloadSchema>

const commandReceiptViewPendingSchema = z
  .object({
    operation: z.enum(["create_session", "submit_message", "edit_message", "regenerate_message", "fork_branch", "activate_branch", "cancel_run", "decide_action", "decide_plan", "update_session", "archive_session", "restore_session", "trash_session", "put_preference", "create_folder", "update_folder", "delete_folder"]),
    command_id: z.string().min(1).max(128),
    idempotency_key: z.string().min(1).max(191),
    digest_algorithm: z.literal("SHA256_CANONICAL_JSON_V2"),
    request_digest: z.string().regex(/^[0-9a-f]{64}$/u),
    updated_at: z.string().datetime({ offset: true }),
    status: z.literal("pending"),
    payload: commandRecoveryPayloadSchema,
  })
  .strict()

const commandReceiptViewOutcomeUnknownSchema = z
  .object({
    operation: z.enum(["create_session", "submit_message", "edit_message", "regenerate_message", "fork_branch", "activate_branch", "cancel_run", "decide_action", "decide_plan", "update_session", "archive_session", "restore_session", "trash_session", "put_preference", "create_folder", "update_folder", "delete_folder"]),
    command_id: z.string().min(1).max(128),
    idempotency_key: z.string().min(1).max(191),
    digest_algorithm: z.literal("SHA256_CANONICAL_JSON_V2"),
    request_digest: z.string().regex(/^[0-9a-f]{64}$/u),
    updated_at: z.string().datetime({ offset: true }),
    status: z.literal("outcome_unknown"),
    payload: commandRecoveryPayloadSchema,
  })
  .strict()

const commandReceiptViewAcceptedSchema = z
  .object({
    operation: z.enum(["create_session", "submit_message", "edit_message", "regenerate_message", "fork_branch", "activate_branch", "cancel_run", "decide_action", "decide_plan", "update_session", "archive_session", "restore_session", "trash_session", "put_preference", "create_folder", "update_folder", "delete_folder"]),
    command_id: z.string().min(1).max(128),
    idempotency_key: z.string().min(1).max(191),
    digest_algorithm: z.literal("SHA256_CANONICAL_JSON_V2"),
    request_digest: z.string().regex(/^[0-9a-f]{64}$/u),
    updated_at: z.string().datetime({ offset: true }),
    status: z.literal("accepted"),
    payload: sessionCommandEffectSchema,
  })
  .strict()

const commandReceiptViewAppliedSchema = z
  .object({
    operation: z.enum(["create_session", "submit_message", "edit_message", "regenerate_message", "fork_branch", "activate_branch", "cancel_run", "decide_action", "decide_plan", "update_session", "archive_session", "restore_session", "trash_session", "put_preference", "create_folder", "update_folder", "delete_folder"]),
    command_id: z.string().min(1).max(128),
    idempotency_key: z.string().min(1).max(191),
    digest_algorithm: z.literal("SHA256_CANONICAL_JSON_V2"),
    request_digest: z.string().regex(/^[0-9a-f]{64}$/u),
    updated_at: z.string().datetime({ offset: true }),
    status: z.literal("applied"),
    payload: sessionCommandEffectSchema,
  })
  .strict()

const commandReceiptViewDeniedSchema = z
  .object({
    operation: z.enum(["create_session", "submit_message", "edit_message", "regenerate_message", "fork_branch", "activate_branch", "cancel_run", "decide_action", "decide_plan", "update_session", "archive_session", "restore_session", "trash_session", "put_preference", "create_folder", "update_folder", "delete_folder"]),
    command_id: z.string().min(1).max(128),
    idempotency_key: z.string().min(1).max(191),
    digest_algorithm: z.literal("SHA256_CANONICAL_JSON_V2"),
    request_digest: z.string().regex(/^[0-9a-f]{64}$/u),
    updated_at: z.string().datetime({ offset: true }),
    status: z.literal("denied"),
    payload: errorDetailSchema,
  })
  .strict()

export const commandReceiptViewSchema = z.discriminatedUnion("status", [
  commandReceiptViewPendingSchema,
  commandReceiptViewOutcomeUnknownSchema,
  commandReceiptViewAcceptedSchema,
  commandReceiptViewAppliedSchema,
  commandReceiptViewDeniedSchema,
])
.superRefine((value, context) => {
  if (value.status !== "accepted" && value.status !== "applied") return
  const expectedKind = ({ "create_session": "session-created", "submit_message": "run-launch-created", "edit_message": "run-launch-created", "regenerate_message": "run-launch-created", "fork_branch": "branch-updated", "activate_branch": "branch-updated", "cancel_run": "cancellation-requested", "decide_action": "action-decision-recorded", "decide_plan": "plan-decision-recorded", "update_session": "session-updated", "archive_session": "session-updated", "restore_session": "session-updated", "trash_session": "session-updated", "put_preference": "preference-updated", "create_folder": "folder-updated", "update_folder": "folder-updated", "delete_folder": "folder-deleted" } as const)[value.operation]
  if (value.payload.kind !== expectedKind) context.addIssue({ code: "custom", path: ["payload", "kind"], message: "command receipt operation/effect mismatch" })
})
export type CommandReceiptView = z.infer<typeof commandReceiptViewSchema>

export const commandReceiptLookupQuerySchema = z
  .object({
    operation: z.enum(["create_session", "submit_message", "edit_message", "regenerate_message", "fork_branch", "activate_branch", "cancel_run", "decide_action", "decide_plan", "update_session", "archive_session", "restore_session", "trash_session", "put_preference", "create_folder", "update_folder", "delete_folder"]),
    idempotency_key: z.string().min(1).max(191),
    digest_algorithm: z.literal("SHA256_CANONICAL_JSON_V2"),
    request_digest: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict()
export type CommandReceiptLookupQuery = z.infer<typeof commandReceiptLookupQuerySchema>

export const sessionCommandResponseSchema = z
  .object({
    command_receipt: commandReceiptViewSchema,
  })
  .strict()
export type SessionCommandResponse = z.infer<typeof sessionCommandResponseSchema>

export const textSpanSchema = z
  .object({
    text: z.string(),
  })
  .strict()
export type TextSpan = z.infer<typeof textSpanSchema>

export const textPartPayloadSchema = z
  .object({
    part_ref: z.string().min(1).max(256).optional(),
    spans: z.array(textSpanSchema),
  })
  .strict()
export type TextPartPayload = z.infer<typeof textPartPayloadSchema>

export const reasoningPartPayloadSchema = z
  .object({
    part_ref: z.string().min(1).max(256),
    safe_summary: z.string(),
  })
  .strict()
export type ReasoningPartPayload = z.infer<typeof reasoningPartPayloadSchema>

export const citationPartPayloadSchema = z
  .object({
    source_ref: z.string().min(1),
    title: z.string().min(1),
    locator: z.string().min(1).optional(),
    attribution: z.string().min(1).optional(),
  })
  .strict()
export type CitationPartPayload = z.infer<typeof citationPartPayloadSchema>

export const toolCallPartPayloadSchema = z
  .object({
    tool_call_id: z.string().min(1),
    tool_label: z.string().min(1),
    input_summary: z.record(z.string(), z.unknown()).optional(),
    status: z.string().min(1),
    safe_result_preview: z.string().max(16384).optional(),
    is_error: z.boolean().optional(),
    truncated: z.boolean().optional(),
    effect_ref: z.string().min(1).optional(),
    receipt_ref: z.string().min(1).optional(),
  })
  .strict()
export type ToolCallPartPayload = z.infer<typeof toolCallPartPayloadSchema>

export const actionPartPayloadSchema = z
  .object({
    owner_ref: z.string().min(1),
    expected_version: z.number().int().positive(),
    decision_group_ref: z.string().min(1),
    required_owner_refs: z.array(z.string().min(1)).min(1).max(64),
    title: z.string().min(1),
    description: z.string().min(1),
    risk_summary: z.string().min(1).optional(),
    safe_request_summary: z.record(z.string(), z.unknown()).optional(),
    input_schema_ref: z.string().min(1).optional(),
    safe_input_schema: z.record(z.string(), z.unknown()).optional(),
    deadline: z.string().datetime({ offset: true }).optional(),
    allowed_actions: z.array(z.string().min(1)),
    receipt_ref: z.string().min(1).optional(),
    status: z.string().min(1),
  })
  .strict()
export type ActionPartPayload = z.infer<typeof actionPartPayloadSchema>

export const planStepSchema = z
  .object({
    step_ref: z.string().min(1),
    label: z.string().min(1),
    status: z.string().min(1),
  })
  .strict()
export type PlanStep = z.infer<typeof planStepSchema>

export const planPartPayloadSchema = z
  .object({
    plan_proposal_ref: z.string().min(1),
    plan_version: z.number().int().positive(),
    summary: z.string().min(1),
    steps: z.array(planStepSchema),
    allowed_actions: z.array(z.string().min(1)),
    deadline: z.string().datetime({ offset: true }).optional(),
    receipt_ref: z.string().min(1).optional(),
    status: z.string().min(1),
  })
  .strict()
export type PlanPartPayload = z.infer<typeof planPartPayloadSchema>

export const planProgressPartPayloadSchema = z
  .object({
    plan_ref: z.string().min(1).max(256),
    safe_summary: z.string().min(1),
    steps: z.array(planStepSchema),
  })
  .strict()
export type PlanProgressPartPayload = z.infer<typeof planProgressPartPayloadSchema>

export const subagentPartPayloadSchema = z
  .object({
    subagent_ref: z.string().min(1).max(256),
    status: z.enum(["pending", "running", "completed", "failed", "canceled"]),
    safe_summary: z.string().optional(),
  })
  .strict()
export type SubagentPartPayload = z.infer<typeof subagentPartPayloadSchema>

export const mediaOperationPartPayloadSchema = z
  .object({
    media_operation_ref: z.string().min(1).max(256),
    capability: z.string().min(1),
    status: z.string().min(1),
    safe_metadata: z.record(z.string(), z.unknown()),
    progress_bps: z.number().int().min(0).max(10000).optional(),
    artifact_ref: z.string().min(1).max(256).optional(),
  })
  .strict()
export type MediaOperationPartPayload = z.infer<typeof mediaOperationPartPayloadSchema>

export const artifactPartPayloadSchema = z
  .object({
    artifact_ref: z.string().min(1).max(256),
    version_ref: z.string().min(1).max(256),
    content_type: z.string().min(1).optional(),
    safe_metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
export type ArtifactPartPayload = z.infer<typeof artifactPartPayloadSchema>

export const costPartPayloadSchema = z
  .object({
    cost_projection_ref: z.string().min(1),
    status: z.enum(["none", "reserved", "committed", "cost_pending", "settled", "released", "reconciliation_required"]),
    amount: z.string().min(1).optional(),
    currency_or_credit_unit: z.string().min(1).optional(),
    freshness: z.string().datetime({ offset: true }),
  })
  .strict()
export type CostPartPayload = z.infer<typeof costPartPayloadSchema>

export const noticePartPayloadSchema = z
  .object({
    notice_ref: z.string().min(1).max(256),
    code: z.string().min(1),
    message: z.string(),
    severity: z.enum(["info", "warning"]),
    retry_class: z.enum(["never", "immediate", "after_delay", "after_user_action", "reconcile_receipt"]).optional(),
    support_correlation_ref: z.string().min(1).optional(),
  })
  .strict()
export type NoticePartPayload = z.infer<typeof noticePartPayloadSchema>

export const errorPartPayloadSchema = z
  .object({
    error_ref: z.string().min(1).max(256),
    code: z.string().min(1),
    message: z.string(),
    retry_class: z.enum(["never", "immediate", "after_delay", "after_user_action", "reconcile_receipt"]),
    support_correlation_ref: z.string().min(1).optional(),
  })
  .strict()
export type ErrorPartPayload = z.infer<typeof errorPartPayloadSchema>

export const unsupportedPartPayloadSchema = z
  .object({
    original_kind: z.string().min(1),
    original_schema_version: z.number().int().positive(),
    safe_fallback: z.string().min(1),
  })
  .strict()
export type UnsupportedPartPayload = z.infer<typeof unsupportedPartPayloadSchema>

const messagePartEnvelopeTextSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("text"),
    payload: textPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeReasoningSummarySchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("reasoning-summary"),
    payload: reasoningPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeCitationSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("citation"),
    payload: citationPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeToolCallSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("tool-call"),
    payload: toolCallPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeApprovalSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("approval"),
    payload: actionPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeInteractionSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("interaction"),
    payload: actionPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopePlanSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("plan"),
    payload: planPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopePlanProgressSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("plan-progress"),
    payload: planProgressPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeSubagentSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("subagent"),
    payload: subagentPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeMediaOperationSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("media-operation"),
    payload: mediaOperationPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeArtifactSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("artifact"),
    payload: artifactPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeCostSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("cost"),
    payload: costPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeNoticeSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("notice"),
    payload: noticePartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeErrorSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    kind: z.literal("error"),
    payload: errorPartPayloadSchema,
  })
  .strict()

const messagePartEnvelopeUnsupportedSchema = z
  .object({
    part_id: z.string().min(1),
    message_id: z.string().min(1),
    ordinal: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    schema_version: z.literal(1),
    lifecycle: z.literal("unsupported"),
    kind: z.literal("unsupported"),
    payload: unsupportedPartPayloadSchema,
  })
  .strict()

export const messagePartEnvelopeSchema = z.discriminatedUnion("kind", [
  messagePartEnvelopeTextSchema,
  messagePartEnvelopeReasoningSummarySchema,
  messagePartEnvelopeCitationSchema,
  messagePartEnvelopeToolCallSchema,
  messagePartEnvelopeApprovalSchema,
  messagePartEnvelopeInteractionSchema,
  messagePartEnvelopePlanSchema,
  messagePartEnvelopePlanProgressSchema,
  messagePartEnvelopeSubagentSchema,
  messagePartEnvelopeMediaOperationSchema,
  messagePartEnvelopeArtifactSchema,
  messagePartEnvelopeCostSchema,
  messagePartEnvelopeNoticeSchema,
  messagePartEnvelopeErrorSchema,
  messagePartEnvelopeUnsupportedSchema,
])
export type MessagePartEnvelope = z.infer<typeof messagePartEnvelopeSchema>

export const attachmentSafeRefSchema = z
  .object({
    ordinal: z.number().int().nonnegative(),
    asset_ref: z.string().min(1),
    asset_version_ref: z.string().min(1),
    asset_grant_ref: z.string().min(1),
    readiness: z.string().min(1),
    media_type: z.string().min(1),
    display_name: z.string().min(1),
    size_bytes: z.number().int().nonnegative(),
  })
  .strict()
export type AttachmentSafeRef = z.infer<typeof attachmentSafeRefSchema>

export const messageRecordSchema = z
  .object({
    message_id: z.string().min(1),
    branch_id: z.string().min(1),
    parent_message_id: z.string().min(1).optional(),
    role: z.enum(["user", "assistant", "system"]),
    ordinal: z.number().int().nonnegative(),
    trigger_message_id: z.string().min(1).optional(),
    run_id: z.string().min(1).optional(),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    parts: z.array(messagePartEnvelopeSchema),
    attachments: z.array(attachmentSafeRefSchema),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
export type MessageRecord = z.infer<typeof messageRecordSchema>

export const conversationBranchSchema = z
  .object({
    branch_id: z.string().min(1),
    parent_branch_id: z.string().min(1).optional(),
    forked_from_message_id: z.string().min(1).optional(),
    root_message_id: z.string().min(1).optional(),
    leaf_message_id: z.string().min(1).optional(),
    origin: z.enum(["original", "edit", "regenerate", "fork"]),
    version: z.number().int().positive(),
    created_at: z.string().datetime({ offset: true }),
  })
  .strict()
export type ConversationBranch = z.infer<typeof conversationBranchSchema>

export const sessionMetadataSchema = z
  .object({
    session_id: z.string().min(1),
    project_ref: z.string().min(1),
    title: z.string().min(1),
    lifecycle: z.enum(["active", "archived", "trashed"]),
    active_branch_id: z.string().min(1),
    active_leaf_message_id: z.string().min(1).optional(),
    version: z.number().int().positive(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
export type SessionMetadata = z.infer<typeof sessionMetadataSchema>

export const runLaunchProjectionSchema = z
  .object({
    launch_id: z.string().min(1),
    branch_id: z.string().min(1),
    trigger_message_id: z.string().min(1),
    proposed_run_id: z.string().min(1),
    status: z.enum(["intent_recorded", "admission_pending", "waiting_prerequisite", "reserved", "committed", "dispatch_pending", "dispatched", "event_observed", "released", "denied", "outcome_unknown", "failed"]),
    command_receipt_ref: z.string().min(1),
    manifest_ref: z.string().min(1).optional(),
    failure_code: z.string().min(1).optional(),
    version: z.number().int().positive(),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
export type RunLaunchProjection = z.infer<typeof runLaunchProjectionSchema>

export const runViewSchema = z
  .object({
    run_id: z.string().min(1),
    launch_id: z.string().min(1),
    branch_id: z.string().min(1),
    assistant_message_id: z.string().min(1),
    execution_status: z.enum(["admission_pending", "waiting_prerequisite", "running", "paused", "cancelling", "completed", "failed", "canceled", "outcome_unknown"]),
    cost_status: z.enum(["none", "reserved", "committed", "cost_pending", "settled", "released", "reconciliation_required"]),
    terminal_outcome: z.string().min(1).optional(),
    last_durable_cursor: z.string().min(1),
    projection_version: z.number().int().positive(),
  })
  .strict()
export type RunView = z.infer<typeof runViewSchema>

export const controlProjectionSchema = z
  .object({
    decision_id: z.string().min(1),
    run_id: z.string().min(1),
    kind: z.string().min(1),
    status: z.enum(["pending", "persisted", "applied", "failed", "outcome_unknown"]),
    command_receipt_ref: z.string().min(1),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict()
export type ControlProjection = z.infer<typeof controlProjectionSchema>

export const runCostProjectionSchema = z
  .object({
    run_id: z.string().min(1),
    cost_status: z.enum(["none", "reserved", "committed", "cost_pending", "settled", "released", "reconciliation_required"]),
    estimate: z.string().min(1).optional(),
    rated_amount: z.string().min(1).optional(),
    currency_or_credit_unit: z.string().min(1).optional(),
    rating_snapshot_ref: z.string().min(1).optional(),
    usage_evidence_refs: z.array(z.string().min(1)),
    freshness: z.string().datetime({ offset: true }),
  })
  .strict()
export type RunCostProjection = z.infer<typeof runCostProjectionSchema>

export const capabilityDisplaySnapshotSchema = z
  .object({
    capability_snapshot_ref: z.string().min(1),
    agent_label: z.string().min(1).optional(),
    skill_labels: z.array(z.string().min(1)),
    mcp_labels: z.array(z.string().min(1)),
    source: z.literal("admission_snapshot"),
  })
  .strict()
export type CapabilityDisplaySnapshot = z.infer<typeof capabilityDisplaySnapshotSchema>

export const modelDisplaySnapshotSchema = z
  .object({
    model_option_revision_ref: z.string().min(1),
    label: z.string().min(1),
    effort: z.string().min(1).max(64).optional(),
  })
  .strict()
export type ModelDisplaySnapshot = z.infer<typeof modelDisplaySnapshotSchema>

export const snapshotWatermarkSchema = z
  .object({
    cursor: z.string().min(1),
    stream_epoch: z.string().min(1),
    durable_seq: z.string().regex(/^(0|[1-9][0-9]{0,19})$/u).refine((value) => value.length < 20 || value <= "18446744073709551615"),
    projection_version: z.number().int().positive(),
  })
  .strict()
export type SnapshotWatermark = z.infer<typeof snapshotWatermarkSchema>

export const sessionSnapshotSchema = z
  .object({
    session: sessionMetadataSchema,
    branches: z.array(conversationBranchSchema),
    messages: z.array(messageRecordSchema),
    run_launches: z.array(runLaunchProjectionSchema),
    runs: z.array(runViewSchema),
    controls: z.array(controlProjectionSchema),
    costs: z.array(runCostProjectionSchema),
    capability_display: capabilityDisplaySnapshotSchema.optional(),
    model_history: z.array(modelDisplaySnapshotSchema),
    snapshot_watermark: snapshotWatermarkSchema,
    next_page_cursor: z.string().min(1).optional(),
  })
  .strict()
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>

export const sessionListItemSchema = z
  .object({
    session: sessionMetadataSchema,
    pinned: z.boolean(),
    folder_id: z.string().min(1).optional(),
    preference_version: z.number().int().positive(),
    safe_text_highlight: z.string().optional(),
  })
  .strict()
export type SessionListItem = z.infer<typeof sessionListItemSchema>

export const sessionListSchema = z
  .object({
    sessions: z.array(sessionListItemSchema),
    index_watermark: z.string().min(1),
    next_cursor: z.string().min(1).optional(),
  })
  .strict()
export type SessionList = z.infer<typeof sessionListSchema>

export const listSessionsQuerySchema = z
  .object({
    project_ref: z.string().min(1).max(256),
    q: z.string().min(1).max(512).optional(),
    lifecycle: z.enum(["active", "archived", "trashed"]).optional(),
    folder_id: z.string().min(1).max(128).optional(),
    pinned: z.boolean().optional(),
    sort: z.enum(["updated_desc"]).optional(),
    cursor: z.string().min(1).max(8192).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
export type ListSessionsQuery = z.infer<typeof listSessionsQuerySchema>

export const snapshotQuerySchema = z
  .object({
    cursor: z.string().min(1).max(8192).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
export type SnapshotQuery = z.infer<typeof snapshotQuerySchema>

export const streamQuerySchema = z
  .object({
    after: z.string().min(1).max(8192).optional(),
  })
  .strict()
export type StreamQuery = z.infer<typeof streamQuerySchema>

export const createSessionRequestSchema = z
  .object({
    project_ref: z.string().min(1).max(256),
    command: commandIdentitySchema,
    title: z.string().min(1).max(256).optional(),
  })
  .strict()
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>

export const attachmentIntentSchema = z
  .object({
    asset_ref: z.string().min(1).max(256),
    asset_version_ref: z.string().min(1).max(256),
    asset_grant_ref: z.string().min(1).max(256),
  })
  .strict()
export type AttachmentIntent = z.infer<typeof attachmentIntentSchema>

export const userTextInputPayloadSchema = z
  .object({
    text: z.string().min(1).max(1048576),
  })
  .strict()
export type UserTextInputPayload = z.infer<typeof userTextInputPayloadSchema>

const messageInputPartTextSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.literal("text"),
    payload: userTextInputPayloadSchema,
  })
  .strict()

export const messageInputPartSchema = z.discriminatedUnion("kind", [
  messageInputPartTextSchema,
])
export type MessageInputPart = z.infer<typeof messageInputPartSchema>

export const submitMessageRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_session_version: z.number().int().positive(),
    branch_id: z.string().min(1).max(128),
    parent_message_id: z.string().min(1).max(128).nullable(),
    trusted_locale: z.string().min(2).max(35),
    parts: z.array(messageInputPartSchema).max(64),
    attachment_refs: z.array(attachmentIntentSchema).max(64),
    model_option_revision_ref: z.string().min(1).max(256),
    effort: z.string().min(1).max(64).optional(),
    requested_agent_option_ref: z.string().min(1).max(256).optional(),
    requested_skill_option_refs: z.array(z.string().min(1).max(256)).max(64).optional(),
    requested_mcp_option_refs: z.array(z.string().min(1).max(256)).max(64).optional(),
  })
  .strict()
.superRefine((value, context) => {
  if (value.parts.length === 0 && value.attachment_refs.length === 0) context.addIssue({ code: "custom", path: ["parts"], message: "at least one of parts, attachment_refs must be non-empty" })
})
export type SubmitMessageRequest = z.infer<typeof submitMessageRequestSchema>

export const editMessageRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_session_version: z.number().int().positive(),
    expected_branch_version: z.number().int().positive(),
    source_branch_id: z.string().min(1).max(128),
    source_message_id: z.string().min(1).max(128),
    parent_message_id: z.string().min(1).max(128).nullable(),
    trusted_locale: z.string().min(2).max(35),
    replacement_parts: z.array(messageInputPartSchema).min(1).max(64),
    replacement_attachment_refs: z.array(attachmentIntentSchema).max(64),
    model_option_revision_ref: z.string().min(1).max(256),
    effort: z.string().min(1).max(64).optional(),
  })
  .strict()
export type EditMessageRequest = z.infer<typeof editMessageRequestSchema>

export const regenerateMessageRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_session_version: z.number().int().positive(),
    expected_branch_version: z.number().int().positive(),
    source_branch_id: z.string().min(1).max(128),
    source_assistant_message_id: z.string().min(1).max(128),
    trigger_message_id: z.string().min(1).max(128),
    parent_message_id: z.string().min(1).max(128).nullable(),
    trusted_locale: z.string().min(2).max(35),
    input_parts: z.array(messageInputPartSchema).min(1).max(64),
    attachment_refs: z.array(attachmentIntentSchema).max(64),
    model_option_revision_ref: z.string().min(1).max(256),
    effort: z.string().min(1).max(64).optional(),
  })
  .strict()
export type RegenerateMessageRequest = z.infer<typeof regenerateMessageRequestSchema>

export const branchCommandRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_session_version: z.number().int().positive(),
    expected_branch_version: z.number().int().positive(),
  })
  .strict()
export type BranchCommandRequest = z.infer<typeof branchCommandRequestSchema>

export const sessionLifecycleCommandRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_session_version: z.number().int().positive(),
  })
  .strict()
export type SessionLifecycleCommandRequest = z.infer<typeof sessionLifecycleCommandRequestSchema>

export const cancellationRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_run_projection_version: z.number().int().positive(),
    reason_code: z.string().min(1).max(128),
  })
  .strict()
export type CancellationRequest = z.infer<typeof cancellationRequestSchema>

export const approveActionDecisionSchema = z
  .object({
    acknowledged_risk: z.literal(true),
  })
  .strict()
export type ApproveActionDecision = z.infer<typeof approveActionDecisionSchema>

export const rejectActionDecisionSchema = z
  .object({
    reason_code: z.string().min(1).max(128).optional(),
  })
  .strict()
export type RejectActionDecision = z.infer<typeof rejectActionDecisionSchema>

export const editActionDecisionSchema = z
  .object({
    input_schema_ref: z.string().min(1).max(256),
    edited_input: z.record(z.string(), z.unknown()),
  })
  .strict()
export type EditActionDecision = z.infer<typeof editActionDecisionSchema>

export const interactionTextResponseSchema = z
  .object({
    text: z.string().min(1).max(1048576),
  })
  .strict()
export type InteractionTextResponse = z.infer<typeof interactionTextResponseSchema>

export const interactionSelectionResponseSchema = z
  .object({
    selected_option_ids: z.array(z.string().min(1).max(256)).min(1).max(64),
  })
  .strict()
export type InteractionSelectionResponse = z.infer<typeof interactionSelectionResponseSchema>

export const interactionFormResponseSchema = z
  .object({
    fields: z.record(z.string(), z.unknown()),
  })
  .strict()
export type InteractionFormResponse = z.infer<typeof interactionFormResponseSchema>

const interactionResponseTextSchema = z
  .object({
    kind: z.literal("text"),
    payload: interactionTextResponseSchema,
  })
  .strict()

const interactionResponseSelectionSchema = z
  .object({
    kind: z.literal("selection"),
    payload: interactionSelectionResponseSchema,
  })
  .strict()

const interactionResponseFormSchema = z
  .object({
    kind: z.literal("form"),
    payload: interactionFormResponseSchema,
  })
  .strict()

export const interactionResponseSchema = z.discriminatedUnion("kind", [
  interactionResponseTextSchema,
  interactionResponseSelectionSchema,
  interactionResponseFormSchema,
])
export type InteractionResponse = z.infer<typeof interactionResponseSchema>

export const respondActionDecisionSchema = z
  .object({
    input_schema_ref: z.string().min(1).max(256),
    response: interactionResponseSchema,
  })
  .strict()
export type RespondActionDecision = z.infer<typeof respondActionDecisionSchema>

const actionDecisionApproveSchema = z
  .object({
    kind: z.literal("approve"),
    payload: approveActionDecisionSchema,
  })
  .strict()

const actionDecisionRejectSchema = z
  .object({
    kind: z.literal("reject"),
    payload: rejectActionDecisionSchema,
  })
  .strict()

const actionDecisionEditSchema = z
  .object({
    kind: z.literal("edit"),
    payload: editActionDecisionSchema,
  })
  .strict()

const actionDecisionRespondSchema = z
  .object({
    kind: z.literal("respond"),
    payload: respondActionDecisionSchema,
  })
  .strict()

export const actionDecisionSchema = z.discriminatedUnion("kind", [
  actionDecisionApproveSchema,
  actionDecisionRejectSchema,
  actionDecisionEditSchema,
  actionDecisionRespondSchema,
])
export type ActionDecision = z.infer<typeof actionDecisionSchema>

export const actionDecisionRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_session_version: z.number().int().positive(),
    expected_run_projection_version: z.number().int().positive(),
    owner_kind: z.enum(["approval", "interaction"]),
    owner_ref: z.string().min(1).max(256),
    decision_group_ref: z.string().min(1).max(256),
    expected_owner_version: z.number().int().positive(),
    decision: actionDecisionSchema,
  })
  .strict()
export type ActionDecisionRequest = z.infer<typeof actionDecisionRequestSchema>

export const acceptPlanDecisionSchema = z.object({}).strict()
export type AcceptPlanDecision = z.infer<typeof acceptPlanDecisionSchema>

export const rejectPlanDecisionSchema = z
  .object({
    reason_code: z.string().min(1).max(128).optional(),
  })
  .strict()
export type RejectPlanDecision = z.infer<typeof rejectPlanDecisionSchema>

const planDecisionAcceptSchema = z
  .object({
    kind: z.literal("accept"),
    payload: acceptPlanDecisionSchema,
  })
  .strict()

const planDecisionRejectSchema = z
  .object({
    kind: z.literal("reject"),
    payload: rejectPlanDecisionSchema,
  })
  .strict()

export const planDecisionSchema = z.discriminatedUnion("kind", [
  planDecisionAcceptSchema,
  planDecisionRejectSchema,
])
export type PlanDecision = z.infer<typeof planDecisionSchema>

export const planDecisionRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_session_version: z.number().int().positive(),
    expected_run_projection_version: z.number().int().positive(),
    plan_proposal_ref: z.string().min(1).max(256),
    expected_plan_version: z.number().int().positive(),
    decision: planDecisionSchema,
  })
  .strict()
export type PlanDecisionRequest = z.infer<typeof planDecisionRequestSchema>

export const updateSessionRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_version: z.number().int().positive(),
    title: z.string().min(1).max(256),
  })
  .strict()
export type UpdateSessionRequest = z.infer<typeof updateSessionRequestSchema>

export const preferenceRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_version: z.number().int().positive(),
    pinned: z.boolean(),
    folder_id: z.string().min(1).max(128).nullable(),
  })
  .strict()
export type PreferenceRequest = z.infer<typeof preferenceRequestSchema>

export const createFolderRequestSchema = z
  .object({
    command: commandIdentitySchema,
    project_ref: z.string().min(1).max(256),
    name: z.string().min(1).max(128),
  })
  .strict()
export type CreateFolderRequest = z.infer<typeof createFolderRequestSchema>

export const updateFolderRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_version: z.number().int().positive(),
    name: z.string().min(1).max(128),
  })
  .strict()
export type UpdateFolderRequest = z.infer<typeof updateFolderRequestSchema>

export const folderDeleteRequestSchema = z
  .object({
    command: commandIdentitySchema,
    expected_version: z.number().int().positive(),
  })
  .strict()
export type FolderDeleteRequest = z.infer<typeof folderDeleteRequestSchema>

export const folderViewSchema = z
  .object({
    folder_id: z.string().min(1),
    project_ref: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
  })
  .strict()
export type FolderView = z.infer<typeof folderViewSchema>

export const folderListQuerySchema = z
  .object({
    project_ref: z.string().min(1).max(256),
    cursor: z.string().min(1).max(8192).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict()
export type FolderListQuery = z.infer<typeof folderListQuerySchema>

export const folderListSchema = z
  .object({
    folders: z.array(folderViewSchema),
    next_cursor: z.string().min(1).optional(),
  })
  .strict()
export type FolderList = z.infer<typeof folderListSchema>

export const BROWSER_COMMAND_DIGEST_ALGORITHM = "SHA256_CANONICAL_JSON_V2" as const

export const BROWSER_COMMAND_TARGET_KEYS = Object.freeze({
  "create_session": Object.freeze([]),
  "submit_message": Object.freeze(["session_id"]),
  "edit_message": Object.freeze(["session_id", "message_id"]),
  "regenerate_message": Object.freeze(["session_id", "message_id"]),
  "fork_branch": Object.freeze(["session_id", "branch_id"]),
  "activate_branch": Object.freeze(["session_id", "branch_id"]),
  "cancel_run": Object.freeze(["session_id", "run_id"]),
  "decide_action": Object.freeze(["session_id", "run_id"]),
  "decide_plan": Object.freeze(["session_id", "run_id"]),
  "update_session": Object.freeze(["session_id"]),
  "archive_session": Object.freeze(["session_id"]),
  "restore_session": Object.freeze(["session_id"]),
  "trash_session": Object.freeze(["session_id"]),
  "put_preference": Object.freeze(["session_id"]),
  "create_folder": Object.freeze([]),
  "update_folder": Object.freeze(["folder_id"]),
  "delete_folder": Object.freeze(["folder_id"]),
} as const)

export type BrowserCommandOperation = keyof typeof BROWSER_COMMAND_TARGET_KEYS

export type BrowserCommandDigestInput = Readonly<{
  operation: BrowserCommandOperation
  targets: Readonly<Record<string, string>>
  effect: Readonly<Record<string, unknown>>
}>

/** Exact v2 preimage shared by browser and Session before SHA-256. */
export function canonicalBrowserCommandDigestPreimage(input: BrowserCommandDigestInput): string {
  const expectedKeys = BROWSER_COMMAND_TARGET_KEYS[input.operation] as readonly string[] | undefined
  if (expectedKeys === undefined) throw new Error("BROWSER_COMMAND_OPERATION_INVALID")
  if (!plainBrowserCommandRecord(input.targets)) {
    throw new Error("BROWSER_COMMAND_TARGETS_INVALID")
  }
  const actualKeys = Object.keys(input.targets).sort()
  const canonicalExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== canonicalExpectedKeys.length ||
    actualKeys.some((key, index) => key !== canonicalExpectedKeys[index])
  ) throw new Error("BROWSER_COMMAND_TARGETS_INVALID")
  const targets: Record<string, string> = {}
  for (const key of expectedKeys) {
    const value = input.targets[key]
    if (typeof value !== "string" || value.length < 1 || value.length > 128) {
      throw new Error("BROWSER_COMMAND_TARGETS_INVALID")
    }
    targets[key] = value
  }
  if (!plainBrowserCommandRecord(input.effect) || Object.hasOwn(input.effect, "command")) {
    throw new Error("BROWSER_COMMAND_EFFECT_INVALID")
  }
  return canonicalBrowserCommandJson({ operation: input.operation, targets, effect: input.effect })
}

function canonicalBrowserCommandJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("BROWSER_COMMAND_EFFECT_INVALID")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalBrowserCommandJson).join(",")}]`
  if (plainBrowserCommandRecord(value)) {
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, child]) =>
      `${JSON.stringify(key)}:${canonicalBrowserCommandJson(child)}`).join(",")}}`
  }
  throw new Error("BROWSER_COMMAND_EFFECT_INVALID")
}

function plainBrowserCommandRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function parseSessionSnapshot(input: unknown): SessionSnapshot {
  return sessionSnapshotSchema.parse(input)
}

export const LAST_EVENT_ID_HEADER = "last-event-id"

export const snapshotPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const streamPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const submitMessagePathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const editMessagePathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    message_id: z.string().min(1).max(128),
  })
  .strict()

export const regenerateMessagePathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    message_id: z.string().min(1).max(128),
  })
  .strict()

export const forkBranchPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    branch_id: z.string().min(1).max(128),
  })
  .strict()

export const activateBranchPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    branch_id: z.string().min(1).max(128),
  })
  .strict()

export const cancelRunPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    run_id: z.string().min(1).max(128),
  })
  .strict()

export const decideActionPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    run_id: z.string().min(1).max(128),
  })
  .strict()

export const decidePlanPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
    run_id: z.string().min(1).max(128),
  })
  .strict()

export const getCommandReceiptPathParamsSchema = z
  .object({
    command_id: z.string().min(1).max(128),
  })
  .strict()

export const updateSessionPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const archiveSessionPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const restoreSessionPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const trashSessionPathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const putPreferencePathParamsSchema = z
  .object({
    session_id: z.string().min(1).max(128),
  })
  .strict()

export const updateFolderPathParamsSchema = z
  .object({
    folder_id: z.string().min(1).max(128),
  })
  .strict()

export const deleteFolderPathParamsSchema = z
  .object({
    folder_id: z.string().min(1).max(128),
  })
  .strict()

export const SESSION_HTTP_ENDPOINTS = Object.freeze({
  createSession: Object.freeze({ method: "POST", path: "/v1/sessions", status: 201, pathSchema: null, requestSchema: createSessionRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  listSessions: Object.freeze({ method: "GET", path: "/v1/sessions", status: 200, pathSchema: null, requestSchema: null, querySchema: listSessionsQuerySchema, responseSchema: sessionListSchema, query: Object.freeze([]), authorization: null }),
  snapshot: Object.freeze({ method: "GET", path: "/v1/sessions/{session_id}/snapshot", status: 200, pathSchema: snapshotPathParamsSchema, requestSchema: null, querySchema: snapshotQuerySchema, responseSchema: sessionSnapshotSchema, query: Object.freeze([]), authorization: null }),
  stream: Object.freeze({ method: "GET", path: "/v1/sessions/{session_id}/events", status: 200, pathSchema: streamPathParamsSchema, requestSchema: null, querySchema: streamQuerySchema, responseSchema: null, query: Object.freeze([]), authorization: null }),
  submitMessage: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/messages", status: 202, pathSchema: submitMessagePathParamsSchema, requestSchema: submitMessageRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  editMessage: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/messages/{message_id}:edit", status: 202, pathSchema: editMessagePathParamsSchema, requestSchema: editMessageRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  regenerateMessage: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/messages/{message_id}:regenerate", status: 202, pathSchema: regenerateMessagePathParamsSchema, requestSchema: regenerateMessageRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  forkBranch: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/branches/{branch_id}:fork", status: 202, pathSchema: forkBranchPathParamsSchema, requestSchema: branchCommandRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  activateBranch: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/branches/{branch_id}:activate", status: 202, pathSchema: activateBranchPathParamsSchema, requestSchema: branchCommandRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  cancelRun: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/runs/{run_id}:cancel", status: 202, pathSchema: cancelRunPathParamsSchema, requestSchema: cancellationRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  decideAction: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/runs/{run_id}/actions:decide", status: 202, pathSchema: decideActionPathParamsSchema, requestSchema: actionDecisionRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  decidePlan: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}/runs/{run_id}/plans:decide", status: 202, pathSchema: decidePlanPathParamsSchema, requestSchema: planDecisionRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  getCommandReceipt: Object.freeze({ method: "GET", path: "/v1/session-commands/{command_id}/receipt", status: 200, pathSchema: getCommandReceiptPathParamsSchema, requestSchema: null, querySchema: commandReceiptLookupQuerySchema, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: "subject-site-command-receipt-grant" }),
  updateSession: Object.freeze({ method: "PATCH", path: "/v1/sessions/{session_id}", status: 202, pathSchema: updateSessionPathParamsSchema, requestSchema: updateSessionRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  archiveSession: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}:archive", status: 202, pathSchema: archiveSessionPathParamsSchema, requestSchema: sessionLifecycleCommandRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  restoreSession: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}:restore", status: 202, pathSchema: restoreSessionPathParamsSchema, requestSchema: sessionLifecycleCommandRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  trashSession: Object.freeze({ method: "POST", path: "/v1/sessions/{session_id}:trash", status: 202, pathSchema: trashSessionPathParamsSchema, requestSchema: sessionLifecycleCommandRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  putPreference: Object.freeze({ method: "PUT", path: "/v1/sessions/{session_id}/preference", status: 202, pathSchema: putPreferencePathParamsSchema, requestSchema: preferenceRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  listFolders: Object.freeze({ method: "GET", path: "/v1/session-folders", status: 200, pathSchema: null, requestSchema: null, querySchema: folderListQuerySchema, responseSchema: folderListSchema, query: Object.freeze([]), authorization: null }),
  createFolder: Object.freeze({ method: "POST", path: "/v1/session-folders", status: 201, pathSchema: null, requestSchema: createFolderRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  updateFolder: Object.freeze({ method: "PATCH", path: "/v1/session-folders/{folder_id}", status: 202, pathSchema: updateFolderPathParamsSchema, requestSchema: updateFolderRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
  deleteFolder: Object.freeze({ method: "DELETE", path: "/v1/session-folders/{folder_id}", status: 202, pathSchema: deleteFolderPathParamsSchema, requestSchema: folderDeleteRequestSchema, querySchema: null, responseSchema: sessionCommandResponseSchema, query: Object.freeze([]), authorization: null }),
})

export function sessionsPath(): string {
  return `/v1/sessions`
}
export function snapshotPath(sessionId: string): string {
  return `/v1/sessions/${sessionId}/snapshot`
}
export function eventsPath(sessionId: string): string {
  return `/v1/sessions/${sessionId}/events`
}
export function messagesPath(sessionId: string): string {
  return `/v1/sessions/${sessionId}/messages`
}
export function editMessagePath(sessionId: string, messageId: string): string {
  return `/v1/sessions/${sessionId}/messages/${messageId}:edit`
}
export function regenerateMessagePath(sessionId: string, messageId: string): string {
  return `/v1/sessions/${sessionId}/messages/${messageId}:regenerate`
}
export function forkBranchPath(sessionId: string, branchId: string): string {
  return `/v1/sessions/${sessionId}/branches/${branchId}:fork`
}
export function activateBranchPath(sessionId: string, branchId: string): string {
  return `/v1/sessions/${sessionId}/branches/${branchId}:activate`
}
export function cancellationPath(sessionId: string, runId: string): string {
  return `/v1/sessions/${sessionId}/runs/${runId}:cancel`
}
export function actionDecisionPath(sessionId: string, runId: string): string {
  return `/v1/sessions/${sessionId}/runs/${runId}/actions:decide`
}
export function planDecisionPath(sessionId: string, runId: string): string {
  return `/v1/sessions/${sessionId}/runs/${runId}/plans:decide`
}
export function commandReceiptPath(commandId: string): string {
  return `/v1/session-commands/${commandId}/receipt`
}
export function sessionPath(sessionId: string): string {
  return `/v1/sessions/${sessionId}`
}
export function archiveSessionPath(sessionId: string): string {
  return `/v1/sessions/${sessionId}:archive`
}
export function restoreSessionPath(sessionId: string): string {
  return `/v1/sessions/${sessionId}:restore`
}
export function trashSessionPath(sessionId: string): string {
  return `/v1/sessions/${sessionId}:trash`
}
export function preferencePath(sessionId: string): string {
  return `/v1/sessions/${sessionId}/preference`
}
export function foldersPath(): string {
  return `/v1/session-folders`
}
export function folderPath(folderId: string): string {
  return `/v1/session-folders/${folderId}`
}
