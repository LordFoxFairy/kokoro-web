import { useEffect, useRef } from "react"

import {
  type ConversationStore,
  setActivePending,
  withActiveThread,
} from "@/application/conversation-store"
import { type SessionStreamState } from "@/application/session-stream/reducer"
import {
  reattachLiveSession,
  type LiveSessionHandle,
} from "@/application/session-stream/transport"

import { type TransportSession } from "./use-transport-session"

// 中断恢复用的重连接口：不发新 POST，只重订阅某 session 的 SSE 续传。可注入以便测试。
export type ReattachReply = (args: {
  sessionId: string
  // 刷新前持久化的在途 runId：reattach 据此只在本轮终态收束，不被历史 run 终态提前关流。
  runId?: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamState) => void
  onSettled: () => void
}) => LiveSessionHandle

export const defaultReattach: ReattachReply = (args) =>
  reattachLiveSession({
    sessionId: args.sessionId,
    runId: args.runId,
    initialState: args.initialState,
    onState: args.onState,
    onSettled: args.onSettled,
  })

// 重连兜底：若 90s 内未收到终态（后端已停/网络长断），放弃续传以免永久卡在 streaming。
const REATTACH_TIMEOUT_MS = 90_000

type UseSessionReattachArgs = {
  pendingConvId: string | null
  store: ConversationStore | null
  reattach: ReattachReply
  nowMs: () => number
  setLiveStore: (
    updater: (prev: ConversationStore | null) => ConversationStore | null,
  ) => void
  transport: TransportSession
}

// 中断恢复协作者：活跃会话有在途 run 时重订阅其 SSE 续传；每个 pending 会话只触发一次。
export function useSessionReattach({
  pendingConvId,
  store,
  reattach,
  nowMs,
  setLiveStore,
  transport,
}: UseSessionReattachArgs): void {
  // 把每帧都在变的依赖（store/nowMs/transport/setLiveStore）经 ref 透传，
  // 使 effect 真正只依赖 pendingConvId/reattach——重连只需在 pending 会话切换时捕获一次当时的 store，
  // 把 store 列入 deps 会让每个流式增量重跑此 effect、误清兜底计时器。
  const latest = useRef({ store, nowMs, setLiveStore, transport })
  // 本 effect 声明在重连 effect 之前，提交时先于它运行，确保重连取到本帧最新值（不在 render 期写 ref）。
  useEffect(() => {
    latest.current = { store, nowMs, setLiveStore, transport }
  })

  useEffect(() => {
    const tx = latest.current.transport
    const reattachedRef = tx.reattachedRef
    if (!pendingConvId || reattachedRef.current === pendingConvId) {
      return
    }
    // 闭包捕获 pendingConvId 变为非空那一刻的 store（含在途会话与其线程）。
    const base = latest.current.store
    const entry = base?.conversations.find((e) => e.id === pendingConvId)
    if (!base || !entry) {
      return
    }
    reattachedRef.current = pendingConvId
    tx.beginReattach(entry.pendingInput ?? "")

    const settle = () => {
      tx.settle()
      latest.current.setLiveStore((prev) =>
        prev ? setActivePending(prev, undefined) : prev,
      )
    }

    const handle = reattach({
      sessionId: pendingConvId,
      runId: entry.pendingRunId,
      initialState: entry.thread,
      onState: (next) => {
        tx.clearReconnecting()
        latest.current.setLiveStore((prev) =>
          withActiveThread(prev ?? base, next, latest.current.nowMs()),
        )
      },
      onSettled: settle,
    })
    tx.replyHandleRef.current = handle

    // 兜底：长时间无终态（后端已停/网络长断）则放弃续传，避免永久卡在 streaming。
    const timeout = setTimeout(() => {
      handle.close()
      settle()
    }, REATTACH_TIMEOUT_MS)

    return () => {
      clearTimeout(timeout)
    }
  }, [pendingConvId, reattach])
}
