import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"

import {
  applySessionEvent,
  createSessionStreamState,
  type SessionStreamState,
} from "./session-stream-reducer"

const previewEvents: SessionStreamEvent[] = [
  {
    kind: "session-created",
    eventId: "evt_00",
    sessionId: "ses_01",
    conversationId: "conv_01",
    runId: "run_01",
    ownerId: "usr_01",
    title: "Warm launch preview",
  },
  {
    kind: "message-delta",
    eventId: "evt_01",
    sessionId: "ses_01",
    conversationId: "conv_01",
    runId: "run_01",
    messageId: "msg_01",
    role: "assistant",
    delta: "Hello ",
  },
  {
    kind: "message-completed",
    eventId: "evt_02",
    sessionId: "ses_01",
    conversationId: "conv_01",
    runId: "run_01",
    messageId: "msg_01",
    role: "assistant",
    content: "Hello from replay-safe shell.",
  },
  {
    kind: "run-completed",
    eventId: "evt_03",
    sessionId: "ses_01",
    conversationId: "conv_01",
    runId: "run_01",
  },
]

export function createPreviewSessionState(): SessionStreamState {
  // 预览数据在应用层先折叠成稳定 state，接口层只负责展示结果。
  return previewEvents.reduce(applySessionEvent, createSessionStreamState())
}
