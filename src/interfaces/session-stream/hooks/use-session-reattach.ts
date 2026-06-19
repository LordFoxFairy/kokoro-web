import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
} from "react"

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

import { type TransportState } from "./mode-presentation"

// 中断恢复用的重连接口：不发新 POST，只重订阅某 session 的 SSE 续传。可注入以便测试。
export type ReattachReply = (args: {
  sessionId: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamState) => void
  onSettled: () => void
}) => LiveSessionHandle

export const defaultReattach: ReattachReply = (args) =>
  reattachLiveSession({
    sessionId: args.sessionId,
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
  replyHandleRef: MutableRefObject<LiveSessionHandle | null>
  requestInFlightRef: MutableRefObject<boolean>
  lastInputRef: MutableRefObject<string>
  reattachedRef: MutableRefObject<string | null>
  setLiveStore: Dispatch<SetStateAction<ConversationStore | null>>
  setIsStreaming: Dispatch<SetStateAction<boolean>>
  setIsReconnecting: Dispatch<SetStateAction<boolean>>
  setTransportState: Dispatch<SetStateAction<TransportState>>
}

// 中断恢复协作者：活跃会话有在途 run 时重订阅其 SSE 续传；每个 pending 会话只触发一次。
export function useSessionReattach({
  pendingConvId,
  store,
  reattach,
  nowMs,
  replyHandleRef,
  requestInFlightRef,
  lastInputRef,
  reattachedRef,
  setLiveStore,
  setIsStreaming,
  setIsReconnecting,
  setTransportState,
}: UseSessionReattachArgs): void {
  useEffect(() => {
    if (!pendingConvId || reattachedRef.current === pendingConvId) {
      return
    }
    // 闭包捕获 pendingConvId 变为非空那一刻的 store（含在途会话与其线程）。
    const base = store
    const entry = base?.conversations.find((e) => e.id === pendingConvId)
    if (!base || !entry) {
      return
    }
    reattachedRef.current = pendingConvId

    // 重连进入流式态 + isReconnecting：续传窗口内 thread 渲染「重连中…」而非「正在思考…」。
    setIsStreaming(true)
    setIsReconnecting(true)
    setTransportState("live")
    lastInputRef.current = entry.pendingInput ?? ""

    const settle = () => {
      setIsStreaming(false)
      setIsReconnecting(false)
      requestInFlightRef.current = false
      setTransportState("live")
      setLiveStore((prev) => (prev ? setActivePending(prev, undefined) : prev))
    }

    const handle = reattach({
      sessionId: pendingConvId,
      initialState: entry.thread,
      onState: (next) => {
        // 续传第一批事件一到即退出「重连中」——此后是正常流式（思考/出字），不再是等待重连。
        setIsReconnecting(false)
        setLiveStore((prev) => withActiveThread(prev ?? base, next, nowMs()))
      },
      onSettled: settle,
    })
    replyHandleRef.current = handle

    // 兜底：长时间无终态（后端已停/网络长断）则放弃续传，避免永久卡在 streaming。
    const timeout = setTimeout(() => {
      handle.close()
      settle()
    }, REATTACH_TIMEOUT_MS)

    return () => {
      clearTimeout(timeout)
    }
    // 故意只依赖 pendingConvId/reattach：把 store 列入会让每个流式增量重跑此 effect、
    // 误清兜底计时器。我们只需在 pending 会话变化时捕获一次当时的 store。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConvId, reattach])
}
