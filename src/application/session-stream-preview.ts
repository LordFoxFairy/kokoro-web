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

// 传输层监听的事件名全集。artifact.available / permission.required 当前由
// toSessionStreamEvent 显式丢弃，但仍需注册监听器，让丢弃是有意为之而非漏听。
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
  "artifact.available",
  "permission.required",
  "run.completed",
  "run.failed",
] as const

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
  // 持久会话线：让本轮 run 的 assistant 事件折在已有 thread 之上，而不是每轮清零。
  initialState?: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
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

  let state = input.initialState ?? createSessionStreamState()

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
      input.onSettled?.()
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

let localIdCounter = 0

// 本地稳定 id：优先用 crypto.randomUUID，回退到自增计数器；
// 不依赖 Date.now / Math.random，避免 SSR 注水抖动与不确定性。
export function createLocalId(prefix: string): string {
  const cryptoRef =
    typeof globalThis !== "undefined" ? globalThis.crypto : undefined

  if (cryptoRef?.randomUUID) {
    return `${prefix}_${cryptoRef.randomUUID()}`
  }

  localIdCounter += 1
  return `${prefix}_local_${localIdCounter}`
}

function buildSimulatedReplyText(input: string): string {
  const trimmed = input.trim()
  const echo = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
  // 温和、明确为本地预览：真实回答接上 kokoro-session 后从同一处流出。
  return `嗯，我听到了。你说的是「${echo}」。\n\n这是本地预览的流式回复——接上 kokoro-session 后，真实回答会从同一处流出来。`
}

function chunkText(text: string, size = 2): string[] {
  const chunks: string[] = []

  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size))
  }

  return chunks
}

// 纯函数：把一段模拟回复展开成与真实流完全同形的有序 domain 事件，
// 以 run-completed 收尾。可被确定性断言，无需计时器。
export function buildSimulatedReplyEvents(
  input: string,
  ids: { runId: string; messageId: string },
): SessionStreamEvent[] {
  const reply = buildSimulatedReplyText(input)
  const envelope = {
    sessionId: demoSessionId,
    conversationId: demoConversationId,
    runId: ids.runId,
  }

  const deltas: SessionStreamEvent[] = chunkText(reply).map((delta, index) => ({
    kind: "message-delta",
    eventId: `${ids.messageId}-d${index}`,
    ...envelope,
    messageId: ids.messageId,
    role: "assistant",
    delta,
  }))

  return [
    ...deltas,
    {
      kind: "message-completed",
      eventId: `${ids.messageId}-c`,
      ...envelope,
      messageId: ids.messageId,
      role: "assistant",
      content: reply,
    },
    {
      kind: "run-completed",
      eventId: `${ids.runId}-done`,
      ...envelope,
    },
  ]
}

export type SimulateAssistantReplyInput = {
  input: string
  initialState?: SessionStreamState
  ids?: { runId: string; messageId: string }
  stepMs?: number
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
}

// 后端缺席时的优雅降级：把模拟事件按节奏折进同一个 reducer，
// 让 streaming UX 与真实流一致；返回 close() 取消未完成的节拍。
export function simulateAssistantReply(
  args: SimulateAssistantReplyInput,
): LiveSessionHandle {
  const ids = args.ids ?? {
    runId: createLocalId("run"),
    messageId: createLocalId("msg"),
  }
  const events = buildSimulatedReplyEvents(args.input, ids)
  // 本地预览流速：放慢到自然阅读节奏，让"停止生成"键有足够时间被看到并点击。
  const stepMs = args.stepMs ?? 60

  let state = args.initialState ?? createSessionStreamState()
  let index = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let cancelled = false

  const step = () => {
    if (cancelled) {
      return
    }

    const event = events[index]

    if (!event) {
      args.onSettled?.()
      return
    }

    index += 1
    state = applySessionEvent(state, event)
    args.onState(state)
    timer = setTimeout(step, stepMs)
  }

  // 首个增量同步出现，streaming 态即时可见；其余按节拍流出。
  step()

  return {
    close: () => {
      cancelled = true

      if (timer) {
        clearTimeout(timer)
      }
    },
  }
}

export type ReplyMode = "live" | "preview"

export type StartReplyInput = {
  input: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: (mode: ReplyMode) => void
  baseUrl?: string
  sessionId?: string
}

export type StartReply = (args: StartReplyInput) => LiveSessionHandle

// 编排器：优先真实 kokoro-session；POST/传输不可用时本地模拟，
// 让对话在 kokoro-web 单仓内也能完整跑通。settled 时回报落到哪条链路。
export const startSessionReply: StartReply = (args) => {
  let closed = false
  let active: LiveSessionHandle = { close: () => {} }

  const fallbackToPreview = () => {
    if (closed) {
      return
    }

    active = simulateAssistantReply({
      input: args.input,
      initialState: args.initialState,
      onState: args.onState,
      onSettled: () => args.onSettled?.("preview"),
    })
  }

  void (async () => {
    try {
      const handle = await consumeLiveSession({
        input: args.input,
        baseUrl: args.baseUrl,
        sessionId: args.sessionId,
        initialState: args.initialState,
        onState: args.onState,
        onSettled: () => args.onSettled?.("live"),
      })

      if (closed) {
        handle.close()
        return
      }

      active = handle
    } catch {
      fallbackToPreview()
    }
  })()

  return {
    close: () => {
      closed = true
      active.close()
    },
  }
}
