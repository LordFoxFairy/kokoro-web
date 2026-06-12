import type { SessionStreamEvent } from "@/domain/session-stream-event"
import { toSessionStreamEvent } from "@/infrastructure/transport-event-mapper"
import { parseTransportEvent } from "@/infrastructure/transport-event-schema"

import {
  applySessionEvent,
  createSessionStreamState,
  type SessionStreamState,
} from "./reducer"

// 传输层监听的事件名全集；run.created 由 toSessionStreamEvent 映射为 null（解析但不投影）。
const transportEventNames = [
  "session.created",
  "run.created",
  "message.delta",
  "message.completed",
  "thinking.delta",
  "tool.invoked",
  "tool.returned",
  "todo.updated",
  "subagent.started",
  "subagent.finished",
  "subagent.text.delta",
  "subagent.text.completed",
  "run.completed",
  "run.failed",
] as const

export type SessionStreamSnapshot = SessionStreamState

export type LiveSessionHandle = {
  close: () => void
}

export type ConsumeLiveSessionInput = {
  input: string
  baseUrl?: string
  sessionId?: string
  conversationId?: string
  executionStyle?: "fast" | "thinking"
  // 持久会话线：让本轮 run 的 assistant 事件折在已有 thread 之上，而不是每轮清零。
  initialState?: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
  onError?: (event: Event) => void
}

export type ReattachLiveSessionInput = {
  sessionId: string
  baseUrl?: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
  onError?: (event: Event) => void
}

const demoSessionId = "ses_01"
const demoConversationId = "conv_01"

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

// 严格解析 SSE 载荷；任何畸形/未知事件被拒绝且不允许中断整条流。
function decodeStreamMessage(event: Event): SessionStreamEvent | null {
  if (!(event instanceof MessageEvent) || typeof event.data !== "string") {
    return null
  }

  try {
    const raw: unknown = JSON.parse(event.data)
    return toSessionStreamEvent(parseTransportEvent(raw))
  } catch {
    return null
  }
}

type OpenSessionStreamArgs = {
  sessionId: string
  baseUrl: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
  onError?: (event: Event) => void
}

// 打开某 session 的 SSE，把 AGUI 事件折进 reducer，run.completed/run.failed 关闭流。
// 由 consumeLiveSession（先 POST 再监听）与 reattachLiveSession（仅监听、断后续传）共用。
export function openSessionStream(args: OpenSessionStreamArgs): LiveSessionHandle {
  if (typeof EventSource === "undefined") {
    return { close: () => {} }
  }

  let state = args.initialState
  const streamUrl = new URL(`/sessions/${args.sessionId}/stream`, args.baseUrl)
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
    args.onState(state)

    if (
      sessionEvent.kind === "run-completed" ||
      sessionEvent.kind === "run-failed"
    ) {
      close()
      args.onSettled?.()
    }
  }

  for (const eventName of transportEventNames) {
    source.addEventListener(eventName, handleEvent)
  }

  source.onerror = (event) => {
    // 传输瞬断进入可恢复态：保留 EventSource 让浏览器自动重连，不撕毁状态。
    args.onError?.(event)
  }

  return { close }
}

function buildRunUrl(input: ConsumeLiveSessionInput, baseUrl: string) {
  const sessionId = input.sessionId ?? demoSessionId
  const conversationId = input.conversationId ?? demoConversationId
  const requestUrl = new URL(`/sessions/${sessionId}/runs`, baseUrl)
  requestUrl.searchParams.set("conversation_id", conversationId)
  requestUrl.searchParams.set("input", input.input)
  requestUrl.searchParams.set("execution_style", input.executionStyle ?? "fast")
  return { requestUrl, sessionId }
}

// 纯渲染消费者：POST 触发 run，再开 SSE 把 AGUI 事件折进 reducer。
export async function consumeLiveSession(
  input: ConsumeLiveSessionInput,
): Promise<LiveSessionHandle> {
  const baseUrl = input.baseUrl ?? resolveSessionBaseUrl()
  const { requestUrl, sessionId } = buildRunUrl(input, baseUrl)

  const response = await fetch(requestUrl.toString(), { method: "POST" })

  if (!response.ok) {
    throw new Error(`session start failed with status ${response.status}`)
  }

  return openSessionStream({
    sessionId,
    baseUrl,
    initialState: input.initialState ?? createSessionStreamState(),
    onState: input.onState,
    onSettled: input.onSettled,
    onError: input.onError,
  })
}

// 中断恢复：不发新 POST，直接重订阅某 session 的 SSE。session 的 replay 从流首回放，
// 刷新/断线后据此把在途 run 的剩余事件续上（已收到的 eventId 由 reducer 去重）。
export function reattachLiveSession(
  input: ReattachLiveSessionInput,
): LiveSessionHandle {
  return openSessionStream({
    sessionId: input.sessionId,
    baseUrl: input.baseUrl ?? resolveSessionBaseUrl(),
    initialState: input.initialState,
    onState: input.onState,
    onSettled: input.onSettled,
    onError: input.onError,
  })
}
