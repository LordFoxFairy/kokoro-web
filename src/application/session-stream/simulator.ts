import type { SessionStreamEvent } from "@/domain/shared/session-stream-event"

import {
  applySessionEvent,
  createSessionStreamState,
  type SessionStreamState,
} from "./reducer"

import type { LiveSessionHandle, SessionStreamSnapshot } from "./transport"

const demoSessionId = "ses_01"
const demoConversationId = "conv_01"

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
export function chunkText(text: string): string[] {
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
  // 单调 seq：模拟流与真实流同形，按 push 顺序自增，复刻信封游标的发射序号语义。
  let seq = 0
  const nextSeq = () => (seq += 1)

  if (executionStyle === "thinking") {
    chunkText(previewThinking).forEach((delta, index) => {
      events.push({
        kind: "thinking-delta",
        eventId: `${ids.messageId}-t${index}`,
        seq: nextSeq(),
        ...envelope,
        messageId: ids.messageId,
        delta,
      })
    })

    events.push({
      kind: "tool-invoked",
      eventId: `${ids.messageId}-ti`,
      seq: nextSeq(),
      ...envelope,
      messageId: ids.messageId,
      toolId: previewTool.toolId,
      name: previewTool.name,
      args: previewTool.args,
    })
    events.push({
      kind: "tool-returned",
      eventId: `${ids.messageId}-tr`,
      seq: nextSeq(),
      ...envelope,
      messageId: ids.messageId,
      toolId: previewTool.toolId,
      name: previewTool.name,
      result: previewTool.result,
    })

    events.push({
      kind: "todo-updated",
      eventId: `${ids.messageId}-todo`,
      seq: nextSeq(),
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
      seq: nextSeq(),
      ...envelope,
      messageId: ids.messageId,
      role: "assistant",
      delta,
    })
  })

  events.push({
    kind: "message-completed",
    eventId: `${ids.messageId}-c`,
    seq: nextSeq(),
    ...envelope,
    messageId: ids.messageId,
    role: "assistant",
    content: reply,
  })
  events.push({
    kind: "run-completed",
    eventId: `${ids.runId}-done`,
    seq: nextSeq(),
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
