// DO NOT EDIT — generated from contract/events.yaml by contract/generate.py.
// Run `python3 contract/generate.py` after changing the contract.

import { z } from "zod"

const eventEnvelopeSchema = z
  .object({
    event: z.enum([
      "session.created",
      "run.created",
      "thinking.delta",
      "message.delta",
      "message.completed",
      "tool.invoked",
      "tool.awaiting_approval",
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
    // seq：session 透传 agent 的一等发射序号，是真实发射顺序的唯一排序源。
    seq: z.number().int().nonnegative(),
    session_id: z.string().min(1),
    conversation_id: z.string().min(1),
    run_id: z.string().min(1),
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

const thinkingDeltaSchema = eventEnvelopeSchema.extend({
  event: z.literal("thinking.delta"),
  payload: z
    .object({
      segment_id: z.string().min(1),
      delta: z.string(),
    })
    .strict(),
})

const messageDeltaSchema = eventEnvelopeSchema.extend({
  event: z.literal("message.delta"),
  payload: z
    .object({
      segment_id: z.string().min(1),
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
      segment_id: z.string().min(1),
      role: z.enum(["assistant", "user"]),
      content: z.string(),
      citations: z.array(z.unknown()).optional(),
      token_usage: z.unknown().optional(),
    })
    .strict(),
})

const toolInvokedSchema = eventEnvelopeSchema.extend({
  event: z.literal("tool.invoked"),
  payload: z
    .object({
      segment_id: z.string().min(1),
      tool_id: z.string().min(1),
      name: z.string().min(1),
      args: z.record(z.unknown()),
    })
    .strict(),
})

const toolAwaiting_approvalSchema = eventEnvelopeSchema.extend({
  event: z.literal("tool.awaiting_approval"),
  payload: z
    .object({
      segment_id: z.string().min(1),
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
      segment_id: z.string().min(1),
      tool_id: z.string().min(1),
      name: z.string().min(1),
      result: z.string(),
      // 严格 required：生产端始终发送；缺失即 fail-loud，绝不用默认 false 掩盖真失败。无兼容兜底。
      is_error: z.boolean(),
    })
    .strict(),
})

const todoUpdatedSchema = eventEnvelopeSchema.extend({
  event: z.literal("todo.updated"),
  payload: z
    .object({
      todos: z.array(z.object({ content: z.string(), status: z.enum(["pending", "in_progress", "completed"]) }).strict()),
    })
    .strict(),
})

const subagentStartedSchema = eventEnvelopeSchema.extend({
  event: z.literal("subagent.started"),
  payload: z
    .object({
      segment_id: z.string().min(1),
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
      segment_id: z.string().min(1),
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
      segment_id: z.string().min(1),
      subagent_id: z.string().min(1),
      text: z.string(),
    })
    .strict(),
})

const subagentTextCompletedSchema = eventEnvelopeSchema.extend({
  event: z.literal("subagent.text.completed"),
  payload: z
    .object({
      segment_id: z.string().min(1),
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
      // web 放宽到任意非空终态：新终态绝不 strict-parse 成 null 卡死客户端。
      status: z.string().min(1),
      final_message_id: z.string().min(1).optional(),
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
      request_id: z.string().min(1).optional(),
    })
    .strict(),
})

const sessionEventSchema = z.union([
  sessionCreatedSchema,
  runCreatedSchema,
  thinkingDeltaSchema,
  messageDeltaSchema,
  messageCompletedSchema,
  toolInvokedSchema,
  toolAwaiting_approvalSchema,
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

export function parseTransportEvent(input: unknown): SessionTransportEvent {
  return sessionEventSchema.parse(input)
}

export const transportEventNames = [
  "session.created",
  "run.created",
  "thinking.delta",
  "message.delta",
  "message.completed",
  "tool.invoked",
  "tool.awaiting_approval",
  "tool.returned",
  "todo.updated",
  "subagent.started",
  "subagent.finished",
  "subagent.text.delta",
  "subagent.text.completed",
  "run.completed",
  "run.failed",
] as const
