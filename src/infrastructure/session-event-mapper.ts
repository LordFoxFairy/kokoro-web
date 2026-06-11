import type { SessionStreamEvent } from "@/domain/session-stream-event"

import type { SessionTransportEvent } from "./session-event-schema"

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

// 每个被投影事件共享的信封字段；各 case 只在其上补 kind 与 payload 专属字段。
function base(event: SessionTransportEvent, seq: number) {
  return {
    eventId: event.event_id,
    seq,
    sessionId: event.session_id,
    conversationId: event.conversation_id,
    runId: event.run_id,
  }
}

export function toSessionStreamEvent(
  event: SessionTransportEvent,
): SessionStreamEvent | null {
  // 优先用 session 透传的一等 seq；旧/升级期无 seq 的事件 fallback 到 cursor 反解。
  const seq = event.seq ?? parseCursorSeq(event.cursor)

  switch (event.event) {
    case "session.created":
      return {
        kind: "session-created",
        ...base(event, seq),
        title: event.payload.title,
        ownerId: event.payload.owner_id,
      }
    case "run.created":
      // session 真发此事件，web 当前不消费：解析以拒绝畸形，但不投影成领域事件。
      return null
    case "message.delta":
      return {
        kind: "message-delta",
        ...base(event, seq),
        messageId: event.payload.message_id,
        role: event.payload.role,
        delta: event.payload.delta,
      }
    case "message.completed":
      return {
        kind: "message-completed",
        ...base(event, seq),
        messageId: event.payload.message_id,
        role: event.payload.role,
        content: event.payload.content,
      }
    case "run.completed":
      return {
        kind: "run-completed",
        ...base(event, seq),
        finalMessageId: event.payload.final_message_id,
      }
    case "run.failed":
      return {
        kind: "run-failed",
        ...base(event, seq),
        errorKind: event.payload.error_kind,
        message: event.payload.message,
        retryable: event.payload.retryable,
        requestId: event.payload.request_id,
      }
    case "thinking.delta":
      return {
        kind: "thinking-delta",
        ...base(event, seq),
        messageId: event.payload.message_id,
        delta: event.payload.delta,
      }
    case "tool.invoked":
      return {
        kind: "tool-invoked",
        ...base(event, seq),
        messageId: event.payload.message_id,
        toolId: event.payload.tool_id,
        name: event.payload.name,
        args: event.payload.args,
      }
    case "tool.returned":
      return {
        kind: "tool-returned",
        ...base(event, seq),
        messageId: event.payload.message_id,
        toolId: event.payload.tool_id,
        name: event.payload.name,
        result: event.payload.result,
      }
    case "todo.updated":
      return {
        kind: "todo-updated",
        ...base(event, seq),
        todos: event.payload.todos,
      }
    case "subagent.started":
      return {
        kind: "subagent-started",
        ...base(event, seq),
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
        ...base(event, seq),
        messageId: event.payload.message_id,
        subagentId: event.payload.subagent_id,
        name: event.payload.name,
        subagentType: event.payload.subagent_type,
        source: event.payload.source,
      }
    case "subagent.text.delta":
      return {
        kind: "subagent-text-delta",
        ...base(event, seq),
        messageId: event.payload.message_id,
        subagentId: event.payload.subagent_id,
        text: event.payload.text,
      }
    case "subagent.text.completed":
      return {
        kind: "subagent-text-completed",
        ...base(event, seq),
        messageId: event.payload.message_id,
        subagentId: event.payload.subagent_id,
        text: event.payload.text,
      }
  }
}
