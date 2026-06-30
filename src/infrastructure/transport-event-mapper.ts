import type { SessionStreamEvent } from "@/domain/session-stream-event"

import type { SessionTransportEvent } from "./transport-event-schema"

// 每个被投影事件共享的信封字段；各 case 只在其上补 kind 与 payload 专属字段。
function base(event: SessionTransportEvent) {
  return {
    eventId: event.event_id,
    sessionId: event.session_id,
    conversationId: event.conversation_id,
    runId: event.run_id,
  }
}

export function toSessionStreamEvent(
  event: SessionTransportEvent,
): SessionStreamEvent | null {
  switch (event.event) {
    case "session.created":
      return {
        kind: "session-created",
        ...base(event),
        title: event.payload.title,
        ownerId: event.payload.owner_id,
      }
    case "run.created":
      // session 真发此事件，web 当前不消费：解析以拒绝畸形，但不投影成领域事件。
      return null
    case "message.delta":
      return {
        kind: "message-delta",
        ...base(event),
        segmentId: event.payload.segment_id,
        role: event.payload.role,
        delta: event.payload.delta,
      }
    case "message.completed":
      return {
        kind: "message-completed",
        ...base(event),
        segmentId: event.payload.segment_id,
        role: event.payload.role,
        content: event.payload.content,
      }
    case "run.completed":
      return {
        kind: "run-completed",
        ...base(event),
        finalMessageId: event.payload.final_message_id,
      }
    case "run.failed":
      return {
        kind: "run-failed",
        ...base(event),
        errorKind: event.payload.error_kind,
        message: event.payload.message,
        requestId: event.payload.request_id,
      }
    case "thinking.delta":
      return {
        kind: "thinking-delta",
        ...base(event),
        segmentId: event.payload.segment_id,
        delta: event.payload.delta,
      }
    case "tool.invoked":
      return {
        kind: "tool-invoked",
        ...base(event),
        segmentId: event.payload.segment_id,
        toolId: event.payload.tool_id,
        name: event.payload.name,
        args: event.payload.args,
      }
    case "tool.awaiting_approval":
      return {
        kind: "tool-awaiting-approval",
        ...base(event),
        segmentId: event.payload.segment_id,
        toolId: event.payload.tool_id,
        name: event.payload.name,
        args: event.payload.args,
      }
    case "tool.returned":
      return {
        kind: "tool-returned",
        ...base(event),
        segmentId: event.payload.segment_id,
        toolId: event.payload.tool_id,
        name: event.payload.name,
        result: event.payload.result,
        isError: event.payload.is_error,
        // HITL 拒绝标记（仅拒绝时存在）：reducer 据此置 rejected 而非 done，replay 安全。
        ...(event.payload.rejected !== undefined
          ? { rejected: event.payload.rejected }
          : {}),
        // 拒绝理由（仅拒绝时存在）：供 UI 展示，reducer 存到工具实体。
        ...(event.payload.reject_reason !== undefined
          ? { rejectReason: event.payload.reject_reason }
          : {}),
        // 人工答复标记（仅 respond 时存在）：reducer 存到工具实体，UI 显「已人工答复」。
        ...(event.payload.responded !== undefined
          ? { responded: event.payload.responded }
          : {}),
      }
    case "todo.updated":
      return {
        kind: "todo-updated",
        ...base(event),
        todos: event.payload.todos,
      }
    case "subagent.started":
      return {
        kind: "subagent-started",
        ...base(event),
        segmentId: event.payload.segment_id,
        subagentId: event.payload.subagent_id,
        name: event.payload.name,
        description: event.payload.description,
        subagentType: event.payload.subagent_type,
        source: event.payload.source,
      }
    case "subagent.finished":
      return {
        kind: "subagent-finished",
        ...base(event),
        segmentId: event.payload.segment_id,
        subagentId: event.payload.subagent_id,
        name: event.payload.name,
        subagentType: event.payload.subagent_type,
        source: event.payload.source,
        // 子代理失败标记/理由（仅失败时存在）：reducer 据此置 failed 而非 done。
        ...(event.payload.failed !== undefined ? { failed: event.payload.failed } : {}),
        ...(event.payload.error !== undefined ? { error: event.payload.error } : {}),
      }
    case "subagent.text.delta":
      return {
        kind: "subagent-text-delta",
        ...base(event),
        segmentId: event.payload.segment_id,
        subagentId: event.payload.subagent_id,
        text: event.payload.text,
      }
    case "subagent.text.completed":
      return {
        kind: "subagent-text-completed",
        ...base(event),
        segmentId: event.payload.segment_id,
        subagentId: event.payload.subagent_id,
        text: event.payload.text,
      }
    default: {
      // 穷尽性保护：新增 transport 事件类型时在此编译期暴露，而非静默漏映射。
      const _exhaustive: never = event
      return _exhaustive
    }
  }
}
