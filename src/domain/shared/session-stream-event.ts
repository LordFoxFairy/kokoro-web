export type SessionMessageRole = "assistant" | "user"

export type SessionTodoStatus = "pending" | "in_progress" | "completed"

export type SessionTodo = {
  content: string
  status: SessionTodoStatus
}

export type SessionStreamEvent =
  | {
      kind: "thinking-delta"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      messageId: string
      delta: string
    }
  | {
      kind: "tool-invoked"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      toolId: string
      name: string
      args: Record<string, unknown>
    }
  | {
      kind: "tool-returned"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      toolId: string
      name: string
      result: string
    }
  | {
      kind: "todo-updated"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      todos: SessionTodo[]
    }
  | {
      kind: "subagent-started"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      subagentId: string
      name: string
      description: string
    }
  | {
      kind: "subagent-finished"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      subagentId: string
      name: string
    }
  | {
      kind: "session-created"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      title: string
      ownerId: string
    }
  | {
      kind: "message-delta"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      messageId: string
      role: SessionMessageRole
      delta: string
    }
  | {
      kind: "message-completed"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      messageId: string
      role: SessionMessageRole
      content: string
    }
  | {
      kind: "run-completed"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      finalMessageId?: string
      artifactIds?: string[]
    }
  | {
      kind: "run-failed"
      eventId: string
      sessionId: string
      conversationId: string
      runId: string
      errorKind: string
      message: string
      retryable?: boolean
      requestId?: string
    }
