import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"
import {
  parseSessionEvent,
  toSessionStreamEvent,
} from "@/infrastructure/protocol/session-event"

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

const transportEventNames = [
  "session.created",
  "message.delta",
  "message.completed",
  "run.completed",
  "run.failed",
] as const

export const demoSessionId = "ses_01"
export const demoConversationId = "conv_01"

export function resolveSessionBaseUrl() {
  return process.env.NEXT_PUBLIC_KOKORO_SESSION_BASE_URL ?? "http://127.0.0.1:3001"
}

export function createPreviewSessionState(): SessionStreamState {
  // 预览数据在应用层先折叠成稳定 state，接口层只负责展示结果。
  return previewEvents.reduce(applySessionEvent, createSessionStreamState())
}

export async function startDemoSession(baseUrl = resolveSessionBaseUrl()) {
  const requestUrl = new URL(`/sessions/${demoSessionId}/runs`, baseUrl)
  requestUrl.searchParams.set("conversation_id", demoConversationId)
  requestUrl.searchParams.set("input", "hello kokoro")
  requestUrl.searchParams.set("execution_style", "default")

  const response = await fetch(requestUrl.toString(), {
    method: "POST",
  })

  if (!response.ok) {
    throw new Error(`session start failed with status ${response.status}`)
  }
}

export function openDemoSessionStream(
  onEvent: (event: SessionStreamEvent) => void,
  baseUrl = resolveSessionBaseUrl(),
) {
  if (typeof EventSource === "undefined") {
    return () => {}
  }

  const streamUrl = new URL(`/sessions/${demoSessionId}/stream`, baseUrl)
  const source = new EventSource(streamUrl.toString())

  const handleEvent: EventListener = (event) => {
    if (!(event instanceof MessageEvent)) {
      return
    }

    const transportEvent = parseSessionEvent(JSON.parse(event.data) as unknown)
    const sessionEvent = toSessionStreamEvent(transportEvent)

    if (sessionEvent) {
      onEvent(sessionEvent)
    }
  }

  for (const eventName of transportEventNames) {
    source.addEventListener(eventName, handleEvent)
  }

  return () => {
    for (const eventName of transportEventNames) {
      source.removeEventListener(eventName, handleEvent)
    }
    source.close()
  }
}
