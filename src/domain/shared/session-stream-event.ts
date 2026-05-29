export type SessionMessageRole = "assistant" | "user"

export type SessionStreamEvent =
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
