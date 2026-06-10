// 编排器：real 优先，失败降级到本地预览模拟。
// 真实流实现见 session-stream-stream.ts，模拟实现见 session-stream-simulate.ts。

import { consumeLiveSession } from "./session-stream-stream"
import { simulateAssistantReply } from "./session-stream-simulate"
import type { SessionStreamState } from "./session-stream-reducer"
import type { LiveSessionHandle, SessionStreamSnapshot } from "./session-stream-stream"

// Re-export：保持所有已有 consumer 的 import 路径不变。
export type {
  SessionStreamSnapshot,
  LiveSessionHandle,
  ConsumeLiveSessionInput,
  ReattachLiveSessionInput,
} from "./session-stream-stream"
export {
  resolveSessionBaseUrl,
  consumeLiveSession,
  reattachLiveSession,
  openSessionStream,
} from "./session-stream-stream"
export {
  createLocalId,
  chunkText,
  chunkPauseMs,
  buildSimulatedReplyEvents,
  simulateAssistantReply,
} from "./session-stream-simulate"
export type { SimulateAssistantReplyInput } from "./session-stream-simulate"

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
