import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"

export type SessionMessage = {
  id: string
  role: "assistant" | "user"
  content: string
}

export type TimelineItem =
  | {
      type: "message"
      id: string
      role: "assistant" | "user"
      content: string
    }
  | {
      type: "tool"
      toolCallId: string
      toolName: string
      status: "running" | "done"
    }
  | {
      type: "thinking"
      summary: string
    }

export type SessionStreamState = {
  seenEventIds: string[]
  timeline: TimelineItem[]
  messages: SessionMessage[]
  runStatus: "idle" | "completed" | "failed"
}

export function createSessionStreamState(): SessionStreamState {
  return {
    seenEventIds: [],
    timeline: [],
    messages: [],
    runStatus: "idle",
  }
}

// messages 视图由 timeline 派生，保证两个视图永远一致、避免双写漂移。
function deriveMessages(timeline: TimelineItem[]): SessionMessage[] {
  return timeline
    .filter((item): item is Extract<TimelineItem, { type: "message" }> =>
      item.type === "message",
    )
    .map((item) => ({ id: item.id, role: item.role, content: item.content }))
}

export function applySessionEvent(
  state: SessionStreamState,
  event: SessionStreamEvent,
): SessionStreamState {
  // 先按 eventId 去重，保证 replay / resume 的幂等收敛。
  if (state.seenEventIds.includes(event.eventId)) {
    return state
  }

  const timeline = [...state.timeline]

  const nextState: SessionStreamState = {
    ...state,
    seenEventIds: [...state.seenEventIds, event.eventId],
    timeline,
    messages: state.messages,
  }

  if (event.kind === "message-delta") {
    const index = timeline.findIndex(
      (item) => item.type === "message" && item.id === event.messageId,
    )

    if (index >= 0) {
      const existing = timeline[index]
      if (existing?.type === "message") {
        timeline[index] = {
          ...existing,
          content: `${existing.content}${event.delta}`,
        }
      }
    } else {
      timeline.push({
        type: "message",
        id: event.messageId,
        role: event.role,
        content: event.delta,
      })
    }
  }

  if (event.kind === "message-completed") {
    const index = timeline.findIndex(
      (item) => item.type === "message" && item.id === event.messageId,
    )

    const messageItem: TimelineItem = {
      type: "message",
      id: event.messageId,
      role: event.role,
      content: event.content,
    }

    // completed 事件必须覆盖增量正文，避免 replay 后残留半句内容。
    if (index >= 0) {
      timeline[index] = messageItem
    } else {
      timeline.push(messageItem)
    }
  }

  if (event.kind === "tool-started") {
    const exists = timeline.some(
      (item) => item.type === "tool" && item.toolCallId === event.toolCallId,
    )

    if (!exists) {
      timeline.push({
        type: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "running",
      })
    }
  }

  if (event.kind === "tool-completed") {
    const index = timeline.findIndex(
      (item) => item.type === "tool" && item.toolCallId === event.toolCallId,
    )

    if (index >= 0) {
      const existing = timeline[index]
      if (existing?.type === "tool") {
        timeline[index] = { ...existing, status: "done" }
      }
    } else {
      // 找不到配对 started：补一个 done 卡，避免完成事件丢失。
      timeline.push({
        type: "tool",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: "done",
      })
    }
  }

  if (event.kind === "thinking-summary") {
    timeline.push({ type: "thinking", summary: event.summary })
  }

  if (event.kind === "run-completed") {
    nextState.runStatus = "completed"
  }

  if (event.kind === "run-failed") {
    nextState.runStatus = "failed"
  }

  nextState.messages = deriveMessages(timeline)

  return nextState
}
