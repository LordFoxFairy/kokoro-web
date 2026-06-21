// 编排器：real 优先（transport.ts），失败降级到本地预览模拟（simulator.ts）。

import { consumeLiveSession } from "./transport"
import { simulateAssistantReply } from "./simulator"
import type { SessionStreamState } from "./reducer"
import type {
  LiveSessionHandle,
  PermissionMode,
  SessionStreamSnapshot,
} from "./transport"

export type ReplyMode = "live" | "preview"

export type StartReplyInput = {
  input: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamSnapshot) => void
  onSettled?: (mode: ReplyMode) => void
  // 确认走真实 live 链路（POST 成功）时触发，带回执 runId——用于标记「在途 run」以便中断恢复；
  // 预览降级链路不会触发，从而不会把本地模拟误标为可重连。
  onLive?: (runId: string | undefined) => void
  baseUrl?: string
  sessionId?: string
  executionStyle?: "fast" | "thinking"
  permissionMode?: PermissionMode
}

export type StartReply = (args: StartReplyInput) => LiveSessionHandle

// 编排器：优先真实 kokoro-session；POST/传输不可用时本地模拟，
// 让对话在 kokoro-web 单仓内也能完整跑通。settled 时回报落到哪条链路。
export const startSessionReply: StartReply = (args) => {
  let closed = false
  let active: LiveSessionHandle = { close: () => {}, markToolRejected: () => {} }

  // 终态降级，亦是异步链的兜底 rejection handler：自身异常就地吞住,
  // 绝不再向外抛——它已是最后一道防线,逃逸只会变成静默的 unhandledRejection。
  const fallbackToPreview = () => {
    if (closed) {
      return
    }

    try {
      active = simulateAssistantReply({
        input: args.input,
        initialState: args.initialState,
        executionStyle: args.executionStyle,
        onState: args.onState,
        onSettled: () => args.onSettled?.("preview"),
      })
    } catch {
      // 预览本身崩溃无可恢复路径；吞掉以免污染全局未处理 rejection。
    }
  }

  const establishLive = async () => {
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

    try {
      // POST 成功 = live 链路确立：带回执 runId 通知调用方标记在途 run（用于刷新后重连续传）。
      args.onLive?.(handle.runId)
    } catch (error) {
      // onLive 抛错时 SSE 已开：先关掉它再让上层降级,避免 live/preview 双开泄漏 EventSource。
      handle.close()
      throw error
    }

    active = handle
  }

  // 显式消费 promise：POST/传输/超时/回调任一异常都汇入 fallback,不靠 void 静默丢。
  establishLive().catch(fallbackToPreview)

  return {
    close: () => {
      closed = true
      active.close()
    },
    // 委派给当前活跃链路（live 或预览）：拒绝落进它的权威 state。
    markToolRejected: (runId: string) => active.markToolRejected?.(runId),
  }
}
