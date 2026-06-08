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
  "subagent.text.delta",
  "subagent.text.completed",
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
  executionStyle?: "fast" | "thinking"
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
  requestUrl.searchParams.set("execution_style", input.executionStyle ?? "fast")
  return { requestUrl, sessionId }
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
function openSessionStream(args: OpenSessionStreamArgs): LiveSessionHandle {
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

export type ReattachLiveSessionInput = {
  sessionId: string
  baseUrl?: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
  onError?: (event: Event) => void
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

const CJK_PATTERN = /[㐀-鿿぀-ヿ가-힯]/

// token 化：latin 词整块吐出（按空白切，连带尾随空白），CJK 1-3 字一吐，
// 让预览流贴近真实分词节奏而非 2 字硬切。纯字符串操作，无随机/无时钟。
function chunkText(text: string): string[] {
  const chunks: string[] = []
  let index = 0

  while (index < text.length) {
    const char = text[index] ?? ""

    if (CJK_PATTERN.test(char)) {
      // CJK 段：贪婪取至多 3 个连续 CJK 字符为一块。
      let end = index
      while (end < text.length && end - index < 3 && CJK_PATTERN.test(text[end] ?? "")) {
        end += 1
      }
      chunks.push(text.slice(index, end))
      index = end
      continue
    }

    // 非 CJK（含 latin 词、标点、空白、换行）：取到下一个 CJK 边界或空白结尾，
    // 让整词带尾随空白一次性出现。
    let end = index
    while (
      end < text.length &&
      !CJK_PATTERN.test(text[end] ?? "") &&
      !/\s/.test(text[end] ?? "")
    ) {
      end += 1
    }
    // 吞掉紧随的空白，使词与其分隔一同呈现。
    while (end < text.length && /\s/.test(text[end] ?? "") && !CJK_PATTERN.test(text[end] ?? "")) {
      end += 1
    }
    if (end === index) {
      end += 1
    }
    chunks.push(text.slice(index, end))
    index = end
  }

  return chunks
}

const SENTENCE_ENDERS = /[。！？；…、，,.!?;]\s*$/

// 节奏微停顿：纯由 chunk 文本派生——句末标点或空行后稍作停顿，制造可读的呼吸感。
// 返回该 chunk 之后应额外等待的毫秒数（无随机、无时钟读取）。
export function chunkPauseMs(chunk: string): number {
  if (chunk.includes("\n\n") || /\n\s*\n/.test(chunk)) {
    return 220
  }
  if (SENTENCE_ENDERS.test(chunk)) {
    return 140
  }
  if (chunk.includes("\n")) {
    return 80
  }
  return 0
}

const previewTool = {
  toolId: "tool_preview_weather",
  name: "get_weather",
  args: { city: "本地" } as Record<string, unknown>,
  result: "晴，22°C，微风。",
}

const previewThinking =
  "先看用户到底问了什么。这是本地预览，没有接后端，所以我用一段模拟推理演示思考流。接着调一个示例工具，再列两步计划，最后把答案逐字吐出来。"

// 纯函数：把一段模拟回复展开成与真实流完全同形的有序 domain 事件，
// 以 run-completed 收尾。可被确定性断言，无需计时器。
// thinking 模式额外前置 thinking-delta + tool 调用对 + todo 清单；fast 模式直奔答案。
export function buildSimulatedReplyEvents(
  input: string,
  ids: { runId: string; messageId: string },
  executionStyle: "fast" | "thinking" = "fast",
): SessionStreamEvent[] {
  const reply = buildSimulatedReplyText(input)
  const envelope = {
    sessionId: demoSessionId,
    conversationId: demoConversationId,
    runId: ids.runId,
  }

  const events: SessionStreamEvent[] = []

  if (executionStyle === "thinking") {
    chunkText(previewThinking).forEach((delta, index) => {
      events.push({
        kind: "thinking-delta",
        eventId: `${ids.messageId}-t${index}`,
        ...envelope,
        messageId: ids.messageId,
        delta,
      })
    })

    events.push({
      kind: "tool-invoked",
      eventId: `${ids.messageId}-ti`,
      ...envelope,
      messageId: ids.messageId,
      toolId: previewTool.toolId,
      name: previewTool.name,
      args: previewTool.args,
    })
    events.push({
      kind: "tool-returned",
      eventId: `${ids.messageId}-tr`,
      ...envelope,
      messageId: ids.messageId,
      toolId: previewTool.toolId,
      name: previewTool.name,
      result: previewTool.result,
    })

    events.push({
      kind: "todo-updated",
      eventId: `${ids.messageId}-todo`,
      ...envelope,
      todos: [
        { content: "确认用户意图", status: "completed" },
        { content: "组织并流式回答", status: "in_progress" },
      ],
    })
  }

  chunkText(reply).forEach((delta, index) => {
    events.push({
      kind: "message-delta",
      eventId: `${ids.messageId}-d${index}`,
      ...envelope,
      messageId: ids.messageId,
      role: "assistant",
      delta,
    })
  })

  events.push({
    kind: "message-completed",
    eventId: `${ids.messageId}-c`,
    ...envelope,
    messageId: ids.messageId,
    role: "assistant",
    content: reply,
  })
  events.push({
    kind: "run-completed",
    eventId: `${ids.runId}-done`,
    ...envelope,
  })

  return events
}

export type SimulateAssistantReplyInput = {
  input: string
  initialState?: SessionStreamState
  ids?: { runId: string; messageId: string }
  executionStyle?: "fast" | "thinking"
  stepMs?: number
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: () => void
}

// 取事件自带的可见文本，供节奏微停顿派生（无文本的控制事件返回空串）。
function eventChunkText(event: SessionStreamEvent): string {
  if (event.kind === "message-delta" || event.kind === "thinking-delta") {
    return event.delta
  }
  return ""
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
  const executionStyle = args.executionStyle ?? "fast"
  const events = buildSimulatedReplyEvents(args.input, ids, executionStyle)
  // 本地预览流速：thinking 放慢到自然阅读节奏，fast 直奔答案；句末标点再叠加微停顿。
  const stepMs = args.stepMs ?? (executionStyle === "thinking" ? 90 : 40)

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
    timer = setTimeout(step, stepMs + chunkPauseMs(eventChunkText(event)))
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
  // 确认走真实 live 链路（POST 成功）时触发——用于标记「在途 run」以便中断恢复；
  // 预览降级链路不会触发，从而不会把本地模拟误标为可重连。
  onLive?: () => void
  baseUrl?: string
  sessionId?: string
  executionStyle?: "fast" | "thinking"
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
      executionStyle: args.executionStyle,
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
        executionStyle: args.executionStyle,
        initialState: args.initialState,
        onState: args.onState,
        onSettled: () => args.onSettled?.("live"),
      })

      if (closed) {
        handle.close()
        return
      }

      active = handle
      // POST 成功 = live 链路确立：通知调用方标记在途 run（用于刷新后重连续传）。
      args.onLive?.()
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
