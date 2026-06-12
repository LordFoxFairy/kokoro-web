export type SessionMessageRole = "assistant" | "user"

export type SessionTodoStatus = "pending" | "in_progress" | "completed"

export type SessionTodo = {
  content: string
  status: SessionTodoStatus
}

// seq：来自传输信封游标的单调整数（见 toSessionStreamEvent），是真实发射顺序的唯一来源。
export type SessionStreamEvent =
  | {
      kind: "thinking-delta"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      delta: string
    }
  | {
      kind: "tool-invoked"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      toolId: string
      name: string
      args: Record<string, unknown>
    }
  | {
      kind: "tool-returned"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      toolId: string
      name: string
      result: string
    }
  | {
      kind: "todo-updated"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      todos: SessionTodo[]
    }
  | {
      kind: "subagent-started"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      subagentId: string
      name: string
      description: string
      subagentType: string
      source: "built-in" | "config-custom" | "runtime-custom"
    }
  | {
      kind: "subagent-finished"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      subagentId: string
      name: string
      subagentType: string
      source: "built-in" | "config-custom" | "runtime-custom"
    }
  | {
      kind: "subagent-text-delta"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      subagentId: string
      text: string
    }
  | {
      kind: "subagent-text-completed"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      subagentId: string
      text: string
    }
  | {
      kind: "session-created"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      title: string
      ownerId: string
    }
  | {
      kind: "message-delta"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      role: SessionMessageRole
      delta: string
    }
  | {
      kind: "message-completed"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      segmentId: string
      role: SessionMessageRole
      content: string
    }
  | {
      kind: "run-completed"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      finalMessageId?: string
    }
  | {
      kind: "run-failed"
      eventId: string
      seq: number
      sessionId: string
      conversationId: string
      runId: string
      errorKind: string
      message: string
      retryable?: boolean
      requestId?: string
    }
