// GENERATED — DO NOT EDIT. Source: contract/spec/http.yaml
// Regenerate: python3 contract/generate.py

import { z } from "zod"
import { resumeDecisionSchema } from "./control"

export const riskSchema = z
  .object({
    level: z.string().min(1),
    source: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()
export type Risk = z.infer<typeof riskSchema>

export const sessionMetaSchema = z
  .object({
    session_id: z.string().min(1),
    title: z.string().min(1),
    owner_id: z.string().min(1),
    created_at: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict()
export type SessionMeta = z.infer<typeof sessionMetaSchema>

export const messageRecordSchema = z
  .object({
    message_id: z.string().min(1),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    status: z.enum(["pending", "streaming", "completed", "failed"]),
    created_at: z.string().min(1),
    run_id: z.string().min(1).optional(),
  })
  .strict()
export type MessageRecord = z.infer<typeof messageRecordSchema>

export const activeRunSchema = z
  .object({
    run_id: z.string().min(1),
    status: z.string().min(1),
  })
  .strict()
export type ActiveRun = z.infer<typeof activeRunSchema>

export const pendingPauseSchema = z
  .object({
    pause_id: z.string().min(1),
    run_id: z.string().min(1),
    tool_id: z.string().min(1),
    segment_id: z.string().min(1),
    tool_name: z.string().min(1),
    kind: z.enum(["tool_approval", "ask_user_question", "result_review", "input"]),
    args: z.record(z.unknown()),
    description: z.string(),
    allowed_decisions: z.array(z.enum(["approve", "edit", "reject", "respond", "submit"])),
    risk: riskSchema.optional(),
    editable: z.boolean(),
    input_schema: z.record(z.unknown()).optional(),
    result: z.string().optional(),
    status: z.enum(["pending", "resolved", "cancelled", "expired"]),
    decision: z.record(z.unknown()).optional(),
    created_at: z.string().min(1),
    resolved_at: z.string().min(1).optional(),
  })
  .strict()
export type PendingPause = z.infer<typeof pendingPauseSchema>

export const workspaceFileSchema = z
  .object({
    path: z.string().min(1),
    mime: z.string().min(1),
    bytes: z.number().int(),
  })
  .strict()
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>

export const deliverySchema = z
  .object({
    content_hash: z.string().min(1),
    path: z.string().min(1),
    title: z.string().min(1),
    mime: z.string().min(1),
    size: z.number().int(),
    run_id: z.string().min(1),
    created_at: z.string().min(1),
  })
  .strict()
export type Delivery = z.infer<typeof deliverySchema>

export const artifactRecordSchema = z
  .object({
    content_hash: z.string().min(1),
    session_id: z.string().min(1),
    title: z.string().min(1),
    mime: z.string().min(1),
    size: z.number().int(),
    created_at: z.string().min(1),
  })
  .strict()
export type ArtifactRecord = z.infer<typeof artifactRecordSchema>

export const artifactListSchema = z
  .object({
    artifacts: z.array(artifactRecordSchema),
    next_cursor: z.string().min(1).optional(),
  })
  .strict()
export type ArtifactList = z.infer<typeof artifactListSchema>

export const sessionListItemSchema = z
  .object({
    session_id: z.string().min(1),
    title: z.string().min(1),
    updated_at: z.string().min(1),
  })
  .strict()
export type SessionListItem = z.infer<typeof sessionListItemSchema>

export const sessionListSchema = z
  .object({
    sessions: z.array(sessionListItemSchema),
    next_cursor: z.string().min(1).optional(),
  })
  .strict()
export type SessionList = z.infer<typeof sessionListSchema>

export const modelCandidateSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    // 面向用户的展示名（来自模型目录）；缺省时下拉回落 name。
    display_name: z.string().min(1).optional(),
    is_default: z.boolean(),
  })
  .strict()
export type ModelCandidate = z.infer<typeof modelCandidateSchema>

export const modelCandidateListSchema = z
  .object({
    models: z.array(modelCandidateSchema),
  })
  .strict()
export type ModelCandidateList = z.infer<typeof modelCandidateListSchema>

export const agentCandidateSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    is_default: z.boolean(),
  })
  .strict()
export type AgentCandidate = z.infer<typeof agentCandidateSchema>

export const agentCandidateListSchema = z
  .object({
    agents: z.array(agentCandidateSchema),
  })
  .strict()
export type AgentCandidateList = z.infer<typeof agentCandidateListSchema>

export const billingSummarySchema = z
  .object({
    balance_micros: z.string().min(1),
    held_micros: z.string().min(1),
    // 组织配额与周期口径；null=未设(不限)。供配额进度条与低余额预警。
    quota_micros: z.string().min(1).nullable(),
    quota_period: z.string().min(1).nullable(),
  })
  .strict()
export type BillingSummary = z.infer<typeof billingSummarySchema>

export const billingLedgerEntrySchema = z
  .object({
    entry_id: z.string().min(1),
    delta_micros: z.string().min(1),
    // 入账后余额快照（微单位）：余额趋势逐点重建。
    balance_after_micros: z.string().min(1),
    reason: z.string().min(1),
    created_at: z.number().int(),
    run_id: z.string().min(1).nullable().optional(),
  })
  .strict()
export type BillingLedgerEntry = z.infer<typeof billingLedgerEntrySchema>

export const billingLedgerSchema = z
  .object({
    entries: z.array(billingLedgerEntrySchema),
    next_cursor: z.string().min(1).optional(),
  })
  .strict()
export type BillingLedger = z.infer<typeof billingLedgerSchema>

// 按模型消费分解（B1d）：model_name 已由 session 解析；model_binding_id=null→"未归属"。
export const billingByModelItemSchema = z
  .object({
    model_binding_id: z.string().min(1).nullable(),
    model_name: z.string().min(1),
    spent_micros: z.string().min(1),
    run_count: z.number().int().nonnegative(),
  })
  .strict()
export const billingByModelSchema = z
  .object({
    period_start: z.string().min(1),
    items: z.array(billingByModelItemSchema),
  })
  .strict()
export type BillingByModelItem = z.infer<typeof billingByModelItemSchema>
export type BillingByModel = z.infer<typeof billingByModelSchema>

export const sessionSnapshotSchema = z
  .object({
    session: sessionMetaSchema,
    messages: z.array(messageRecordSchema).optional(),
    active_run: activeRunSchema.optional(),
    pending_pauses: z.array(pendingPauseSchema),
    files: z.array(workspaceFileSchema),
    deliveries: z.array(deliverySchema),
    event_watermark: z.number().int(),
  })
  .strict()
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>

export function parseSessionSnapshot(input: unknown): SessionSnapshot {
  return sessionSnapshotSchema.parse(input)
}

export const messageCreateParamsSchema = z
  .object({
    idempotency_key: z.string().min(1),
    content: z.string().min(1),
    model: z.string().min(1).optional(),
    agent: z.string().min(1).optional(),
    thinking: z.boolean().optional(),
    pinned_skills: z.array(z.string().min(1)).optional(),
    mcp_servers: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type MessageCreateParams = z.infer<typeof messageCreateParamsSchema>

export const messageCreateReceiptSchema = z
  .object({
    run_id: z.string().min(1),
    user_message_id: z.string().min(1),
    assistant_message_id: z.string().min(1),
  })
  .strict()
export type MessageCreateReceipt = z.infer<typeof messageCreateReceiptSchema>

export const runControlBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run.cancel"), decision_id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("run.resume"), decision_id: z.string().min(1), decisions: z.array(resumeDecisionSchema).min(1) }).strict(),
])
export type RunControlBody = z.infer<typeof runControlBodySchema>

export const runControlReceiptSchema = z.object({ ok: z.literal(true) }).strict()
export type RunControlReceipt = z.infer<typeof runControlReceiptSchema>

export const renameSessionBodySchema = z.object({ title: z.string().min(1) }).strict()
export type RenameSessionBody = z.infer<typeof renameSessionBodySchema>
export const renameSessionReceiptSchema = z.object({ ok: z.literal(true) }).strict()
export type RenameSessionReceipt = z.infer<typeof renameSessionReceiptSchema>

export const shareReceiptSchema = z.object({ share_id: z.string().min(1) }).strict()
export type ShareReceipt = z.infer<typeof shareReceiptSchema>

export const controlReceiptViewSchema = z.object({ decision_id: z.string().min(1), status: z.enum(["pending", "persisted", "applied", "failed"]) }).strict()
export type ControlReceiptView = z.infer<typeof controlReceiptViewSchema>

export const deleteSessionReceiptSchema = z.object({ status: z.string().min(1) }).strict()
export type DeleteSessionReceipt = z.infer<typeof deleteSessionReceiptSchema>

export const errorResponseSchema = z.object({ error: z.string().min(1) }).strict()
export type ErrorResponse = z.infer<typeof errorResponseSchema>
export const SESSION_RUN_ACTIVE = "session_run_active"
export const LAST_EVENT_ID_HEADER = "last-event-id"

export function messagesPath(sessionId: string): string {
  return `/sessions/${sessionId}/messages`
}
export function snapshotPath(sessionId: string): string {
  return `/sessions/${sessionId}`
}
export function eventsPath(sessionId: string): string {
  return `/sessions/${sessionId}/events`
}
export function filePath(sessionId: string, path: string): string {
  return `/sessions/${sessionId}/files/${path}`
}
export function deliveryPath(sessionId: string, contentHash: string): string {
  return `/sessions/${sessionId}/deliveries/${contentHash}`
}
export function controlPath(sessionId: string, runId: string): string {
  return `/sessions/${sessionId}/runs/${runId}/control`
}
export function controlReceiptPath(sessionId: string, runId: string, decisionId: string): string {
  return `/sessions/${sessionId}/runs/${runId}/control/${decisionId}`
}
export function sessionsPath(): string {
  return `/sessions`
}
export function billingSummaryPath(): string {
  return `/billing/summary`
}
export function billingLedgerPath(): string {
  return `/billing/ledger`
}
export function billingByModelPath(): string {
  return `/billing/by-model`
}
export function modelCandidatesPath(): string {
  return `/models`
}
export function agentCandidatesPath(): string {
  return `/agents`
}
export function artifactsPath(): string {
  return `/artifacts`
}
export function artifactContentPath(contentHash: string): string {
  return `/artifacts/${contentHash}`
}
export function sharePath(sessionId: string): string {
  return `/sessions/${sessionId}/share`
}
export function sharedSnapshotPath(shareId: string): string {
  return `/shared/${shareId}`
}
export function renameSessionPath(sessionId: string): string {
  return `/sessions/${sessionId}/title`
}
