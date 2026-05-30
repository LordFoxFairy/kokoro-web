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
  "tool.started",
  "tool.completed",
  "thinking.summary",
  "run.completed",
  "run.failed",
] as const

export const demoSessionId = "ses_01"
export const demoConversationId = "conv_01"

export function resolveSessionBaseUrl() {
  if (process.env.NEXT_PUBLIC_KOKORO_SESSION_BASE_URL) {
    return process.env.NEXT_PUBLIC_KOKORO_SESSION_BASE_URL
  }

  if (typeof window !== "undefined") {
    const sessionHost = window.location.hostname === "localhost"
      ? "localhost"
      : "127.0.0.1"

    return `http://${sessionHost}:3001`
  }

  return "http://127.0.0.1:3001"
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
    const sessionEvent = decodeStreamMessage(event)

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

// 严格解析 SSE 载荷；任何畸形/未知事件被拒绝且不允许中断整条流。
function decodeStreamMessage(event: Event): SessionStreamEvent | null {
  if (!(event instanceof MessageEvent)) {
    return null
  }

  try {
    const raw: unknown = JSON.parse(event.data as string)
    return toSessionStreamEvent(parseSessionEvent(raw))
  } catch {
    return null
  }
}

export type SessionStreamSnapshot = SessionStreamState

export type LiveSessionHandle = {
  close: () => void
}

export type ConsumeLiveSessionInput = {
  input: string
  baseUrl?: string
  sessionId?: string
  conversationId?: string
  onState: (snapshot: SessionStreamSnapshot) => void
  onError?: (event: Event) => void
}

function buildRunUrl(input: ConsumeLiveSessionInput, baseUrl: string) {
  const sessionId = input.sessionId ?? demoSessionId
  const conversationId = input.conversationId ?? demoConversationId
  const requestUrl = new URL(`/sessions/${sessionId}/runs`, baseUrl)
  requestUrl.searchParams.set("conversation_id", conversationId)
  requestUrl.searchParams.set("input", input.input)
  requestUrl.searchParams.set("execution_style", "default")
  return { requestUrl, sessionId }
}

// 纯渲染消费者：POST 触发 run，开 EventSource，把 AGUI 事件折进 reducer，
// run.completed/run.failed 关闭流，onerror 进可恢复态而不崩。
export async function consumeLiveSession(
  input: ConsumeLiveSessionInput,
): Promise<LiveSessionHandle> {
  const baseUrl = input.baseUrl ?? resolveSessionBaseUrl()
  const { requestUrl, sessionId } = buildRunUrl(input, baseUrl)

  const response = await fetch(requestUrl.toString(), { method: "POST" })

  if (!response.ok) {
    throw new Error(`session start failed with status ${response.status}`)
  }

  let state = createSessionStreamState()

  const noop: LiveSessionHandle = { close: () => {} }

  if (typeof EventSource === "undefined") {
    return noop
  }

  const streamUrl = new URL(`/sessions/${sessionId}/stream`, baseUrl)
  const source = new EventSource(streamUrl.toString())

  const close = () => {
    for (const eventName of transportEventNames) {
      source.removeEventListener(eventName, handleEvent)
    }
    source.close()
  }

  const handleEvent: EventListener = (event) => {
    const sessionEvent = decodeStreamMessage(event)

    if (!sessionEvent) {
      return
    }

    state = applySessionEvent(state, sessionEvent)
    input.onState(state)

    if (
      sessionEvent.kind === "run-completed" ||
      sessionEvent.kind === "run-failed"
    ) {
      close()
    }
  }

  for (const eventName of transportEventNames) {
    source.addEventListener(eventName, handleEvent)
  }

  source.onerror = (event) => {
    // 传输瞬断进入可恢复态：保留 EventSource 让浏览器自动重连，不撕毁状态。
    input.onError?.(event)
  }

  return { close }
}
