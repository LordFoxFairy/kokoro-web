import { useCallback, useEffect, useRef, useState } from "react"

import {
  type ConversationStore,
  setActivePending,
  withActiveThread,
} from "@/application/conversation-store"
import {
  type ReplyMode,
  type StartReply,
} from "@/application/session-stream/reply"
import { type SessionStreamState } from "@/application/session-stream/reducer"
import { type LiveSessionHandle } from "@/application/session-stream/transport"

import { type TransportState } from "./mode-presentation"

type SetLiveStore = (
  updater: (prev: ConversationStore | null) => ConversationStore | null,
) => void

type StartArgs = {
  content: string
  seededThread: SessionStreamState
  storeAtStart: ConversationStore
}

// 在途 run 的句柄与瞬态机所有权全部收敛在此：replyHandleRef/requestInFlightRef/lastInputRef/
// reattachedRef 与 isStreaming/isReconnecting/transportState 不再摊给 useConversation 与 reattach。
export type TransportSession = {
  isStreaming: boolean
  isReconnecting: boolean
  transportState: TransportState
  requestInFlightRef: React.MutableRefObject<boolean>
  lastInputRef: React.MutableRefObject<string>
  reattachedRef: React.MutableRefObject<string | null>
  replyHandleRef: React.MutableRefObject<LiveSessionHandle | null>
  // 发起一轮回复：关旧句柄、推流式态、贴底、交给编排器；onLive/onSettled 内联管理在途标记。
  start: (args: StartArgs) => void
  // 续传窗口起点：进入流式 + 重连态，记录待续输入。
  beginReattach: (pendingInput: string) => void
  // 续传收到首批事件：退出「重连中」，转为普通流式。
  clearReconnecting: () => void
  // run 落定：清在途守卫、退流式、记录落定链路。
  settle: () => void
  // 中止/切换/删除的瞬态复位：关句柄、清守卫、回 idle。reattach=true 时一并放开重连守卫。
  resetTransient: (options?: { reattach?: boolean }) => void
}

export function useTransportSession(
  startReply: StartReply,
  scrollToLatest: () => void,
  mode: "fast" | "thinking",
  permissionMode: "auto" | "default" | "plan",
  setLiveStore: SetLiveStore,
  nowMs: () => number,
): TransportSession {
  const [isStreaming, setIsStreaming] = useState(false)
  // 重连续传态：仅在「重订阅在途 run」的窗口为真（区别于普通流式/思考），驱动「重连中…」锚点。
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [transportState, setTransportState] = useState<TransportState>("idle")

  const replyHandleRef = useRef<LiveSessionHandle | null>(null)
  // 同步在途守卫：isStreaming 是异步 UI 态，两次同步 submit 可能都读到旧值而双发。
  const requestInFlightRef = useRef(false)
  // 保留最近一次用户输入：失败后据此重试同一句，用户无需重新打字。
  const lastInputRef = useRef("")
  // 已重连过的会话 id：避免对同一在途 run 重复重订阅；切换/新建时重置。
  const reattachedRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      replyHandleRef.current?.close()
    }
  }, [])

  const settle = useCallback(() => {
    requestInFlightRef.current = false
    setIsStreaming(false)
    setIsReconnecting(false)
  }, [])

  const start = useCallback(
    ({ content, seededThread, storeAtStart }: StartArgs) => {
      lastInputRef.current = content

      replyHandleRef.current?.close()
      setLiveStore(() => storeAtStart)
      setIsStreaming(true)
      // 主动发起的新一轮不是重连：清掉可能残留的重连态。
      setIsReconnecting(false)
      scrollToLatest()

      replyHandleRef.current = startReply({
        input: content,
        initialState: seededThread,
        // 每个会话用自己的 backend session id（= 会话 id）：replay 流互不混淆，中断恢复可精确重订阅。
        sessionId: storeAtStart.activeId,
        executionStyle: mode,
        permissionMode,
        onState: (next: SessionStreamState) => {
          setTransportState((prev) => (prev === "live" ? prev : "preview"))
          setLiveStore((prev) =>
            withActiveThread(prev ?? storeAtStart, next, nowMs()),
          )
        },
        onLive: () => {
          // 确认 live：标记在途 run，刷新/断线后可重连续传。
          // 本挂载内这轮已由 live 句柄接着——预先占住重连守卫，
          // 否则 pendingInput 一落地重连 effect 就会对在途 run 二次订阅并覆盖句柄。
          reattachedRef.current = storeAtStart.activeId
          setTransportState("live")
          setLiveStore((prev) =>
            prev ? setActivePending(prev, content) : prev,
          )
        },
        onSettled: (replyMode: ReplyMode) => {
          requestInFlightRef.current = false
          setIsStreaming(false)
          setTransportState(replyMode)
          // run 落定：清除在途标记，刷新后不再尝试重连。
          setLiveStore((prev) => (prev ? setActivePending(prev, undefined) : prev))
        },
      })
    },
    [mode, permissionMode, scrollToLatest, startReply, setLiveStore, nowMs],
  )

  const beginReattach = useCallback((pendingInput: string) => {
    // 重连进入流式态 + isReconnecting：续传窗口内 thread 渲染「重连中…」而非「正在思考…」。
    setIsStreaming(true)
    setIsReconnecting(true)
    setTransportState("live")
    lastInputRef.current = pendingInput
  }, [])

  const clearReconnecting = useCallback(() => {
    // 续传第一批事件一到即退出「重连中」——此后是正常流式（思考/出字），不再是等待重连。
    setIsReconnecting(false)
  }, [])

  const resetTransient = useCallback((options?: { reattach?: boolean }) => {
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    if (options?.reattach) {
      // 允许切到（含切回）有在途 run 的会话时重新续传。
      reattachedRef.current = null
    }
    setIsStreaming(false)
    setIsReconnecting(false)
    setTransportState("idle")
  }, [])

  return {
    isStreaming,
    isReconnecting,
    transportState,
    requestInFlightRef,
    lastInputRef,
    reattachedRef,
    replyHandleRef,
    start,
    beginReattach,
    clearReconnecting,
    settle,
    resetTransient,
  }
}
