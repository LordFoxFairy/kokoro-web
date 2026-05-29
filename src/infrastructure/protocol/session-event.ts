import { z } from "zod"

import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"

const eventEnvelopeSchema = z
  .object({
    event: z.enum([
      "session.created",
      "message.delta",
      "message.completed",
      "artifact.available",
      "permission.required",
      "run.completed",
      "run.failed",
    ]),
    event_id: z.string().min(1),
    session_id: z.string().min(1),
    conversation_id: z.string().min(1),
    run_id: z.string().min(1),
    cursor: z.string().min(1),
    timestamp: z.string().datetime(),
  })
  .strict()

const sessionCreatedSchema = eventEnvelopeSchema.extend({
  event: z.literal("session.created"),
  payload: z
    .object({
      session_id: z.string().min(1),
      conversation_id: z.string().min(1),
      owner_id: z.string().min(1),
      title: z.string().min(1),
      workspace_id: z.string().min(1).optional(),
      created_by: z.string().min(1).optional(),
      initial_mode: z.string().min(1).optional(),
    })
    .strict(),
})

const messageDeltaSchema = eventEnvelopeSchema.extend({
  event: z.literal("message.delta"),
  payload: z
    .object({
      message_id: z.string().min(1),
      delta: z.string(),
      role: z.enum(["assistant", "user"]),
      format: z.string().min(1).optional(),
      segment: z.string().min(1).optional(),
    })
    .strict(),
})

const messageCompletedSchema = eventEnvelopeSchema.extend({
  event: z.literal("message.completed"),
  payload: z
    .object({
      message_id: z.string().min(1),
      role: z.enum(["assistant", "user"]),
      content: z.string(),
      citations: z.array(z.unknown()).optional(),
      token_usage: z.unknown().optional(),
    })
    .strict(),
})

const artifactAvailableSchema = eventEnvelopeSchema.extend({
  event: z.literal("artifact.available"),
  payload: z
    .object({
      artifact_id: z.string().min(1),
      artifact_kind: z.string().min(1),
      title: z.string().min(1),
      preview: z.string().optional(),
      open_target: z.string().optional(),
      share_target: z.string().optional(),
    })
    .strict(),
})

const permissionRequiredSchema = eventEnvelopeSchema.extend({
  event: z.literal("permission.required"),
  payload: z
    .object({
      request_id: z.string().min(1),
      decision_kind: z.string().min(1),
      message: z.string().min(1),
      scope: z.string().optional(),
      suggested_default: z.string().optional(),
    })
    .strict(),
})

const runCompletedSchema = eventEnvelopeSchema.extend({
  event: z.literal("run.completed"),
  payload: z
    .object({
      run_id: z.string().min(1),
      status: z.literal("completed"),
      final_message_id: z.string().optional(),
      artifact_ids: z.array(z.string().min(1)).optional(),
    })
    .strict(),
})

const runFailedSchema = eventEnvelopeSchema.extend({
  event: z.literal("run.failed"),
  payload: z
    .object({
      run_id: z.string().min(1),
      error_kind: z.string().min(1),
      message: z.string().min(1),
      retryable: z.boolean().optional(),
      request_id: z.string().optional(),
    })
    .strict(),
})

export const sessionEventSchema = z.union([
  sessionCreatedSchema,
  messageDeltaSchema,
  messageCompletedSchema,
  artifactAvailableSchema,
  permissionRequiredSchema,
  runCompletedSchema,
  runFailedSchema,
])

export type SessionTransportEvent = z.infer<typeof sessionEventSchema>

export function parseSessionEvent(input: unknown): SessionTransportEvent {
  return sessionEventSchema.parse(input)
}

export function toSessionStreamEvent(
  event: SessionTransportEvent,
): SessionStreamEvent | null {
  switch (event.event) {
    case "session.created":
      return {
        kind: event.event,
        eventId: event.event_id,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        title: event.payload.title,
        ownerId: event.payload.owner_id,
      }
    case "message.delta":
      return {
        kind: event.event,
        eventId: event.event_id,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        role: event.payload.role,
        delta: event.payload.delta,
      }
    case "message.completed":
      return {
        kind: event.event,
        eventId: event.event_id,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        role: event.payload.role,
        content: event.payload.content,
      }
    case "run.completed":
      return {
        kind: event.event,
        eventId: event.event_id,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        finalMessageId: event.payload.final_message_id,
        artifactIds: event.payload.artifact_ids,
      }
    case "run.failed":
      return {
        kind: event.event,
        eventId: event.event_id,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        errorKind: event.payload.error_kind,
        message: event.payload.message,
        retryable: event.payload.retryable,
        requestId: event.payload.request_id,
      }
    case "artifact.available":
    case "permission.required":
      return null
  }
}
