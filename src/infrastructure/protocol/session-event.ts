import { z } from "zod"

import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"

// 传输层先严格解析线上的 session envelope，再向内映射成领域可消费事件。
const eventEnvelopeSchema = z
  .object({
    event: z.enum([
      "session.created",
      "run.created",
      "message.delta",
      "message.completed",
      "thinking.delta",
      "tool.invoked",
      "tool.returned",
      "todo.updated",
      "subagent.started",
      "subagent.finished",
      "subagent.text.delta",
      "subagent.text.completed",
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

const runCreatedSchema = eventEnvelopeSchema.extend({
  event: z.literal("run.created"),
  payload: z
    .object({
      run_id: z.string().min(1),
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

// 活动事件族（思考 / 工具 / todo / 子智能体）：与 kokoro-session 出站协议同形。
const thinkingDeltaSchema = eventEnvelopeSchema.extend({
  event: z.literal("thinking.delta"),
  payload: z
    .object({
      message_id: z.string().min(1),
      delta: z.string(),
    })
    .strict(),
})

const toolInvokedSchema = eventEnvelopeSchema.extend({
  event: z.literal("tool.invoked"),
  payload: z
    .object({
      message_id: z.string().min(1),
      tool_id: z.string().min(1),
      name: z.string().min(1),
      args: z.record(z.unknown()),
    })
    .strict(),
})

const toolReturnedSchema = eventEnvelopeSchema.extend({
  event: z.literal("tool.returned"),
  payload: z
    .object({
      message_id: z.string().min(1),
      tool_id: z.string().min(1),
      name: z.string().min(1),
      result: z.string(),
    })
    .strict(),
})

const todoUpdatedSchema = eventEnvelopeSchema.extend({
  event: z.literal("todo.updated"),
  payload: z
    .object({
      todos: z.array(
        z
          .object({
            content: z.string(),
            status: z.enum(["pending", "in_progress", "completed"]),
          })
          .strict(),
      ),
    })
    .strict(),
})

const subagentStartedSchema = eventEnvelopeSchema.extend({
  event: z.literal("subagent.started"),
  payload: z
    .object({
      message_id: z.string().min(1),
      subagent_id: z.string().min(1),
      name: z.string().min(1),
      description: z.string(),
      subagent_type: z.string().min(1),
      source: z.enum(["built-in", "config-custom", "runtime-custom"]),
    })
    .strict(),
})

const subagentFinishedSchema = eventEnvelopeSchema.extend({
  event: z.literal("subagent.finished"),
  payload: z
    .object({
      message_id: z.string().min(1),
      subagent_id: z.string().min(1),
      name: z.string().min(1),
      subagent_type: z.string().min(1),
      source: z.enum(["built-in", "config-custom", "runtime-custom"]),
    })
    .strict(),
})

const subagentTextDeltaSchema = eventEnvelopeSchema.extend({
  event: z.literal("subagent.text.delta"),
  payload: z
    .object({
      message_id: z.string().min(1),
      subagent_id: z.string().min(1),
      text: z.string(),
    })
    .strict(),
})

const subagentTextCompletedSchema = eventEnvelopeSchema.extend({
  event: z.literal("subagent.text.completed"),
  payload: z
    .object({
      message_id: z.string().min(1),
      subagent_id: z.string().min(1),
      text: z.string(),
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

const sessionEventSchema = z.union([
  sessionCreatedSchema,
  runCreatedSchema,
  messageDeltaSchema,
  messageCompletedSchema,
  thinkingDeltaSchema,
  toolInvokedSchema,
  toolReturnedSchema,
  todoUpdatedSchema,
  subagentStartedSchema,
  subagentFinishedSchema,
  subagentTextDeltaSchema,
  subagentTextCompletedSchema,
  artifactAvailableSchema,
  permissionRequiredSchema,
  runCompletedSchema,
  runFailedSchema,
])

export type SessionTransportEvent = z.infer<typeof sessionEventSchema>

export function parseSessionEvent(input: unknown): SessionTransportEvent {
  return sessionEventSchema.parse(input)
}

// 信封游标承载传输层的单调发射序号（如 "run_x:0007" / "1748428800-000012"）。
// 取游标里出现的最后一段连续数字作为 seq：这覆盖 "前缀:NNNN"、"NNNN-NNNN"（取末段）
// 等形态。无任何数字的遗留/畸形游标退化为 0——这类事件不参与有序 Step 的相对定序，
// 但绝不让缺序把整条流判脏。reducer 仍以「同 seq 按到达先后稳定排序」兜底。
function parseCursorSeq(cursor: string): number {
  const matches = cursor.match(/\d+/g)
  if (!matches || matches.length === 0) {
    return 0
  }
  const last = matches[matches.length - 1] ?? "0"
  const value = Number.parseInt(last, 10)
  return Number.isFinite(value) ? value : 0
}

export function toSessionStreamEvent(
  event: SessionTransportEvent,
): SessionStreamEvent | null {
  const seq = parseCursorSeq(event.cursor)

  switch (event.event) {
    case "session.created":
      return {
        kind: "session-created",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        title: event.payload.title,
        ownerId: event.payload.owner_id,
      }
    case "run.created":
      return null
    case "message.delta":
      return {
        kind: "message-delta",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        role: event.payload.role,
        delta: event.payload.delta,
      }
    case "message.completed":
      return {
        kind: "message-completed",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        role: event.payload.role,
        content: event.payload.content,
      }
    case "run.completed":
      return {
        kind: "run-completed",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        finalMessageId: event.payload.final_message_id,
        artifactIds: event.payload.artifact_ids,
      }
    case "run.failed":
      return {
        kind: "run-failed",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        errorKind: event.payload.error_kind,
        message: event.payload.message,
        retryable: event.payload.retryable,
        requestId: event.payload.request_id,
      }
    case "thinking.delta":
      return {
        kind: "thinking-delta",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        delta: event.payload.delta,
      }
    case "tool.invoked":
      return {
        kind: "tool-invoked",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        toolId: event.payload.tool_id,
        name: event.payload.name,
        args: event.payload.args,
      }
    case "tool.returned":
      return {
        kind: "tool-returned",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        toolId: event.payload.tool_id,
        name: event.payload.name,
        result: event.payload.result,
      }
    case "todo.updated":
      return {
        kind: "todo-updated",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        todos: event.payload.todos,
      }
    case "subagent.started":
      return {
        kind: "subagent-started",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        subagentId: event.payload.subagent_id,
        name: event.payload.name,
        description: event.payload.description,
        subagentType: event.payload.subagent_type,
        source: event.payload.source,
      }
    case "subagent.finished":
      return {
        kind: "subagent-finished",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        subagentId: event.payload.subagent_id,
        name: event.payload.name,
        subagentType: event.payload.subagent_type,
        source: event.payload.source,
      }
    case "subagent.text.delta":
      return {
        kind: "subagent-text-delta",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        subagentId: event.payload.subagent_id,
        text: event.payload.text,
      }
    case "subagent.text.completed":
      return {
        kind: "subagent-text-completed",
        eventId: event.event_id,
        seq,
        sessionId: event.session_id,
        conversationId: event.conversation_id,
        runId: event.run_id,
        messageId: event.payload.message_id,
        subagentId: event.payload.subagent_id,
        text: event.payload.text,
      }
    case "artifact.available":
    case "permission.required":
      return null
  }
}
