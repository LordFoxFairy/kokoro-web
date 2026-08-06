// GENERATED — DO NOT EDIT. Source: contract/spec/events.yaml
// Regenerate: python3 contract/generate.py

import { z } from "zod"
import { sessionMetadataSchema, conversationBranchSchema, messageRecordSchema, messagePartEnvelopeSchema, runLaunchProjectionSchema, runViewSchema, controlProjectionSchema, runCostProjectionSchema, commandReceiptViewSchema } from "./http.js"

export const sessionEventContractMetadata = Object.freeze({
  schemaId: "kokoro.session.events.v3",
  schemaVersion: 3,
  sourceDigestSha256: "86cf0536deb410768a58feb65a7b760493a51015187402c882152e363612f178",
})

const todoSchema = z
  .object({
    content: z.string().min(1),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict()

const tokenUsageSchema = z
  .object({
    input_tokens: z.number().int(),
    output_tokens: z.number().int(),
  })
  .strict()

const riskSchema = z
  .object({
    level: z.string().min(1),
    source: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()

const planStepSchema = z
  .object({
    step_ref: z.string().min(1),
    label: z.string().min(1),
    status: z.enum(["pending", "in_progress", "completed"]),
  })
  .strict()

const planProposalSchema = z
  .object({
    summary: z.string().min(1),
    steps: z.array(planStepSchema).min(1).max(256),
    allowed_actions: z.array(z.enum(["accept", "reject"])).min(2).max(2),
  })
  .strict()

const sessionUpdatedPayload = z
  .object({
    session: sessionMetadataSchema,
  })
  .strict()

const branchCreatedPayload = z
  .object({
    branch: conversationBranchSchema,
  })
  .strict()

const branchActivatedPayload = z
  .object({
    branch_id: z.string().min(1),
    active_leaf_message_id: z.string().min(1).optional(),
    session_version: z.number().int().positive(),
  })
  .strict()

const messageCreatedPayload = z
  .object({
    message: messageRecordSchema,
  })
  .strict()

const messagePartUpdatedPayload = z
  .object({
    part: messagePartEnvelopeSchema,
  })
  .strict()

const runLaunchUpdatedPayload = z
  .object({
    launch: runLaunchProjectionSchema,
  })
  .strict()

const runViewUpdatedPayload = z
  .object({
    run: runViewSchema,
  })
  .strict()

const runControlUpdatedPayload = z
  .object({
    control: controlProjectionSchema,
  })
  .strict()

const runCostUpdatedPayload = z
  .object({
    cost: runCostProjectionSchema,
  })
  .strict()

const commandReceiptUpdatedPayload = z
  .object({
    receipt: commandReceiptViewSchema,
  })
  .strict()

const envelope = z
  .object({
    event_id: z.string().min(1),
    cursor: z.string().min(1),
    session_id: z.string().min(1),
    stream_epoch: z.string().min(1),
    durable_seq: z.string().regex(/^[1-9][0-9]{0,19}$/u).refine((value) => value.length < 20 || value <= "18446744073709551615"),
    projection_version: z.number().int().positive(),
    schema_revision: z.number().int().positive(),
    recorded_at: z.string().datetime({ offset: true }),
  })
  .strict()

export const sessionEventSchema = z.discriminatedUnion("kind", [
  envelope.extend({ kind: z.literal("session.updated"), payload: sessionUpdatedPayload }),
  envelope.extend({ kind: z.literal("branch.created"), payload: branchCreatedPayload }),
  envelope.extend({ kind: z.literal("branch.activated"), payload: branchActivatedPayload }),
  envelope.extend({ kind: z.literal("message.created"), payload: messageCreatedPayload }),
  envelope.extend({ kind: z.literal("message.part.updated"), payload: messagePartUpdatedPayload }),
  envelope.extend({ kind: z.literal("run.launch.updated"), payload: runLaunchUpdatedPayload }),
  envelope.extend({ kind: z.literal("run.view.updated"), payload: runViewUpdatedPayload }),
  envelope.extend({ kind: z.literal("run.control.updated"), payload: runControlUpdatedPayload }),
  envelope.extend({ kind: z.literal("run.cost.updated"), payload: runCostUpdatedPayload }),
  envelope.extend({ kind: z.literal("command.receipt.updated"), payload: commandReceiptUpdatedPayload }),
])

export type SessionEvent = z.infer<typeof sessionEventSchema>
export type SessionEventKind = SessionEvent["kind"]

export function parseSessionEvent(input: unknown): SessionEvent {
  return sessionEventSchema.parse(input)
}

const streamDrainingControlFrameSchema = z
  .object({
    kind: z.literal("stream.draining"),
    session_id: z.string().min(1),
    stream_epoch: z.string().min(1),
    last_durable_cursor: z.string().min(1),
    action: z.literal("retry_same_cursor"),
    retry_after_ms: z.number().int().nonnegative().optional(),
  })
  .strict()

export const streamControlFrameSchema = streamDrainingControlFrameSchema
export type StreamControlFrame = z.infer<typeof streamControlFrameSchema>
export const sessionStreamFrameSchema = z.union([sessionEventSchema, streamControlFrameSchema])
export type SessionStreamFrame = z.infer<typeof sessionStreamFrameSchema>

export function parseSessionStreamFrame(input: unknown): SessionStreamFrame {
  return sessionStreamFrameSchema.parse(input)
}
