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
    kind: z.enum(["tool_approval", "ask_user_question", "result_review"]),
    args: z.record(z.unknown()),
    description: z.string(),
    allowed_decisions: z.array(z.enum(["approve", "edit", "reject", "respond"])),
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

export const sessionSnapshotSchema = z
  .object({
    session: sessionMetaSchema,
    messages: z.array(messageRecordSchema),
    active_run: activeRunSchema.optional(),
    pending_pauses: z.array(pendingPauseSchema),
    event_watermark: z.number().int(),
  })
  .strict()
export type SessionSnapshot = z.infer<typeof sessionSnapshotSchema>

export function parseSessionSnapshot(input: unknown): SessionSnapshot {
  return sessionSnapshotSchema.parse(input)
}

export const startMessageBodySchema = z
  .object({
    idempotency_key: z.string().min(1),
    content: z.string().min(1),
    selected_model: z.string().min(1).optional(),
    entry: z.string().min(1).optional(),
  })
  .strict()
export type StartMessageBody = z.infer<typeof startMessageBodySchema>

export const startMessageReceiptSchema = z
  .object({
    run_id: z.string().min(1),
    user_message_id: z.string().min(1),
    assistant_message_id: z.string().min(1),
  })
  .strict()
export type StartMessageReceipt = z.infer<typeof startMessageReceiptSchema>

export const runControlBodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run.cancel"), decision_id: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("run.resume"), decision_id: z.string().min(1), decisions: z.array(resumeDecisionSchema).min(1) }).strict(),
])
export type RunControlBody = z.infer<typeof runControlBodySchema>

export const runControlReceiptSchema = z.object({ ok: z.literal(true) }).strict()
export type RunControlReceipt = z.infer<typeof runControlReceiptSchema>

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
export function controlPath(sessionId: string, runId: string): string {
  return `/sessions/${sessionId}/runs/${runId}/control`
}
