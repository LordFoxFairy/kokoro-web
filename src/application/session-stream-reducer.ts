import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"

export type SessionMessage = {
  id: string
  role: "assistant" | "user"
  content: string
}

export type SessionStreamState = {
  seenEventIds: string[]
  messages: SessionMessage[]
  runStatus: "idle" | "completed" | "failed"
}

export function createSessionStreamState(): SessionStreamState {
  return {
    seenEventIds: [],
    messages: [],
    runStatus: "idle",
  }
}

export function applySessionEvent(
  state: SessionStreamState,
  event: SessionStreamEvent,
): SessionStreamState {
  // 先按 eventId 去重，保证 replay / resume 的幂等收敛。
  if (state.seenEventIds.includes(event.eventId)) {
    return state
  }

  const nextState: SessionStreamState = {
    ...state,
    seenEventIds: [...state.seenEventIds, event.eventId],
    messages: [...state.messages],
  }

  if (event.kind === "message-delta") {
    const index = nextState.messages.findIndex(
      (message) => message.id === event.messageId,
    )

    if (index >= 0) {
      const existing = nextState.messages[index]

      nextState.messages[index] = {
        ...existing,
        content: `${existing?.content ?? ""}${event.delta}`,
      }
    } else {
      nextState.messages.push({
        id: event.messageId,
        role: event.role,
        content: event.delta,
      })
    }
  }

  if (event.kind === "message-completed") {
    const index = nextState.messages.findIndex(
      (message) => message.id === event.messageId,
    )

    // completed 事件必须覆盖增量正文，避免 replay 后残留半句内容。
    if (index >= 0) {
      nextState.messages[index] = {
        id: event.messageId,
        role: event.role,
        content: event.content,
      }
    } else {
      nextState.messages.push({
        id: event.messageId,
        role: event.role,
        content: event.content,
      })
    }
  }

  if (event.kind === "run-completed") {
    nextState.runStatus = "completed"
  }

  if (event.kind === "run-failed") {
    nextState.runStatus = "failed"
  }

  return nextState
}
