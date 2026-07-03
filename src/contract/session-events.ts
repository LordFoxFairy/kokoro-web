// GENERATED — DO NOT EDIT. Source: contract/spec/events.yaml
// Regenerate: python3 contract/generate.py

import { z } from "zod"

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

const sessionCreatedPayload = z
  .object({
    title: z.string().min(1),
    owner_id: z.string().min(1),
  })
  .strict()

const runCreatedPayload = z
  .object({
    run_id: z.string().min(1),
  })
  .strict()

const messageDeltaPayload = z
  .object({
    segment_id: z.string().min(1),
    // 流上文本恒为 assistant，无 role 字段；角色由 segment 归属决定。
    delta: z.string(),
  })
  .strict()

const messageCompletedPayload = z
  .object({
    segment_id: z.string().min(1),
    content: z.string(),
  })
  .strict()

const thinkingDeltaPayload = z
  .object({
    segment_id: z.string().min(1),
    delta: z.string(),
  })
  .strict()

const toolInvokedPayload = z
  .object({
    segment_id: z.string().min(1),
    tool_id: z.string().min(1),
    name: z.string().min(1),
    args: z.record(z.unknown()),
  })
  .strict()

const toolAwaitingApprovalPayload = z
  .object({
    segment_id: z.string().min(1),
    tool_id: z.string().min(1),
    name: z.string().min(1),
    args: z.record(z.unknown()),
    description: z.string(),
    allowed_decisions: z.array(z.enum(["approve", "edit", "reject", "respond"])),
    kind: z.enum(["tool_approval", "ask_user", "result_review"]),
    // 面向 web 的风险摘要，非权限判断真源。
    risk: riskSchema.optional(),
    editable: z.boolean(),
    input_schema: z.record(z.unknown()).optional(),
    // 同帧完整待批 tool_id 列表；HITL『凑齐才提交』契约依据，web 读契约而非内嵌算法。
    pending_tool_ids: z.array(z.string().min(1)),
    // 仅 kind=result_review 时存在：待人工审核的已执行结果（payload 列表尾缀 ? = 该 kind 局部可选）。
    result: z.string().optional(),
  })
  .strict()

const toolReturnedPayload = z
  .object({
    segment_id: z.string().min(1),
    tool_id: z.string().min(1),
    name: z.string().min(1),
    result: z.string(),
    // 严格必填 fail-loud：生产端始终发送；缺失即报错，绝不用默认 false 掩盖真失败。
    is_error: z.boolean(),
    rejected: z.boolean().optional(),
    reject_reason: z.string().optional(),
    responded: z.boolean().optional(),
    // 大结果落 artifact，SSE 只带引用；P1 生产者。
    artifact_ref: z.string().min(1).optional(),
    summary: z.record(z.unknown()).optional(),
  })
  .strict()

const todoUpdatedPayload = z
  .object({
    todos: z.array(todoSchema),
  })
  .strict()

const subagentStartedPayload = z
  .object({
    segment_id: z.string().min(1),
    subagent_id: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    subagent_type: z.string().min(1),
    source: z.enum(["built-in", "config-custom", "runtime-custom"]),
  })
  .strict()

const subagentFinishedPayload = z
  .object({
    segment_id: z.string().min(1),
    subagent_id: z.string().min(1),
    name: z.string().min(1),
    subagent_type: z.string().min(1),
    source: z.enum(["built-in", "config-custom", "runtime-custom"]),
    failed: z.boolean().optional(),
    error: z.string().optional(),
  })
  .strict()

const subagentTextDeltaPayload = z
  .object({
    segment_id: z.string().min(1),
    subagent_id: z.string().min(1),
    text: z.string(),
  })
  .strict()

const subagentTextCompletedPayload = z
  .object({
    segment_id: z.string().min(1),
    subagent_id: z.string().min(1),
    text: z.string(),
  })
  .strict()

const runCompletedPayload = z
  .object({
    status: z.enum(["completed", "cancelled", "timeout"]),
    // agent 认真算的用量全链路贯通；无用量时为 null。
    token_usage: tokenUsageSchema.nullable().optional(),
  })
  .strict()

const runFailedPayload = z
  .object({
    error_kind: z.string().min(1),
    message: z.string().min(1),
  })
  .strict()

const envelope = z
  .object({
    event_id: z.string().min(1),
    seq: z.number().int().nonnegative(),
    session_id: z.string().min(1),
    run_id: z.string().min(1),
    timestamp: z.string().min(1),
  })
  .strict()

export const sessionEventSchema = z.discriminatedUnion("kind", [
  envelope.extend({ kind: z.literal("session.created"), payload: sessionCreatedPayload }),
  envelope.extend({ kind: z.literal("run.created"), payload: runCreatedPayload }),
  envelope.extend({ kind: z.literal("message.delta"), payload: messageDeltaPayload }),
  envelope.extend({ kind: z.literal("message.completed"), payload: messageCompletedPayload }),
  envelope.extend({ kind: z.literal("thinking.delta"), payload: thinkingDeltaPayload }),
  envelope.extend({ kind: z.literal("tool.invoked"), payload: toolInvokedPayload }),
  envelope.extend({ kind: z.literal("tool.awaiting_approval"), payload: toolAwaitingApprovalPayload }),
  envelope.extend({ kind: z.literal("tool.returned"), payload: toolReturnedPayload }),
  envelope.extend({ kind: z.literal("todo.updated"), payload: todoUpdatedPayload }),
  envelope.extend({ kind: z.literal("subagent.started"), payload: subagentStartedPayload }),
  envelope.extend({ kind: z.literal("subagent.finished"), payload: subagentFinishedPayload }),
  envelope.extend({ kind: z.literal("subagent.text.delta"), payload: subagentTextDeltaPayload }),
  envelope.extend({ kind: z.literal("subagent.text.completed"), payload: subagentTextCompletedPayload }),
  envelope.extend({ kind: z.literal("run.completed"), payload: runCompletedPayload }),
  envelope.extend({ kind: z.literal("run.failed"), payload: runFailedPayload }),
])

export type SessionEvent = z.infer<typeof sessionEventSchema>
export type SessionEventKind = SessionEvent["kind"]

export function parseSessionEvent(input: unknown): SessionEvent {
  return sessionEventSchema.parse(input)
}
