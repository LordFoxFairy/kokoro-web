import { z } from "zod"

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
      "run.completed",
      "run.failed",
    ]),
    event_id: z.string().min(1),
    // 一等发射序号（session 透传 agent seq）。optional 兼容升级期旧事件，缺失则 mapper 反解 cursor。
    seq: z.number().int().nonnegative().optional(),
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

const runCompletedSchema = eventEnvelopeSchema.extend({
  event: z.literal("run.completed"),
  payload: z
    .object({
      run_id: z.string().min(1),
      // web 不消费 status(只读 final_message_id):放宽到任意非空终态,新终态绝不 strict-parse 成 null 卡死客户端。
      status: z.string().min(1),
      final_message_id: z.string().optional(),
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
  runCompletedSchema,
  runFailedSchema,
])

export type SessionTransportEvent = z.infer<typeof sessionEventSchema>

export function parseSessionEvent(input: unknown): SessionTransportEvent {
  return sessionEventSchema.parse(input)
}
