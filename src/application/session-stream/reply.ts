// 编排器：real 优先（transport.ts），失败降级到本地预览模拟（simulator.ts）。

import { consumeLiveSession } from "./transport"
import { simulateAssistantReply } from "./simulator"
import type { SessionStreamState } from "./reducer"
import type {
  LiveSessionHandle,
  SessionStreamSnapshot,
} from "./transport"

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
  permissionMode?: "auto" | "default" | "plan"
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
        permissionMode: args.permissionMode,
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
