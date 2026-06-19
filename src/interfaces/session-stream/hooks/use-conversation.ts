import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import {
  type AgentMode,
  type ConversationStore,
  activeThreadOf,
  addConversation,
  removeConversation,
  selectConversation as selectConversationOp,
  setActivePending,
  withActiveThread,
} from "@/application/conversation-store"
import { type LiveSessionHandle } from "@/application/session-stream/transport"
import { createLocalId } from "@/application/session-stream/simulator"
import {
  type ReplyMode,
  type StartReply,
} from "@/application/session-stream/reply"
import {
  appendUserMessage,
  type SessionStreamState,
} from "@/application/session-stream/reducer"

import {
  type ConversationSummary,
  useConversationStore,
} from "./use-conversation-store"
import { useHitlControl } from "./use-hitl-control"
import {
  defaultReattach,
  type ReattachReply,
  useSessionReattach,
} from "./use-session-reattach"
import { MAX_INPUT_LENGTH } from "../components/composer/composer-input"
import {
  modePresentation,
  type ModePresentation,
  type TransportState,
} from "./mode-presentation"

// 对外契约：消费组件从本模块导入这些类型，故在此再导出，保持公开 API 表面稳定。
export type { ConversationSummary } from "./use-conversation-store"
export type { ReattachReply } from "./use-session-reattach"

// 权限档位（Claude-Code 式，会话级全局）：auto 全放行 / default 拦外部副作用 / plan 只读规划。
export type PermissionMode = "auto" | "default" | "plan"

type Conversation = {
  thread: SessionStreamState
  draft: string
  setDraft: (value: string) => void
  isStreaming: boolean
  // 重连续传态：仅在重订阅在途 run 的窗口为真，驱动「重连中…」锚点（区别于普通思考）。
  isReconnecting: boolean
  transportLabel: string
  presentation: ModePresentation
  composerRef: RefObject<HTMLTextAreaElement | null>
  retry: () => void
  stopReply: () => void
  startNewChat: () => void
  handleSubmit: (event: FormEvent<HTMLFormElement>) => void
  handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  canSend: boolean
  hasMessages: boolean
  hasFailed: boolean
  // 多会话：左侧列表 + 切换 / 删除。
  conversations: ConversationSummary[]
  activeId: string | null
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  // 回应模式：Fast / Thinking。每会话独立；首条消息后锁定（modeLocked）不可再切换。
  mode: AgentMode
  setMode: (mode: AgentMode) => void
  modeLocked: boolean
  // 权限档位（会话级，可随时切换，作用于下一轮 run）。
  permissionMode: PermissionMode
  setPermissionMode: (mode: PermissionMode) => void
  // HITL：批准/拒绝某 run 待批的工具调用。若 control POST 失败，Promise reject 让按钮层恢复可重试。
  sendToolDecision: (
    runId: string,
    decision: "approve" | "reject",
  ) => Promise<void>
}

function nowMs(): number {
  // 仅在用户动作（提交/新建/切换）里调用，不在 render —— 不引入 SSR 注水抖动。
  return Date.now()
}

export function useConversation(
  startReply: StartReply,
  scrollToLatest: () => void,
  reattach: ReattachReply = defaultReattach,
): Conversation {
  const {
    store,
    setLiveStore,
    persistedStore,
    pendingConvId,
    thread,
    conversations,
    activeId,
    mode,
    modeLocked,
    pendingMode,
    setMode,
  } = useConversationStore()

  const [draft, setDraft] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  // 重连续传态：仅在「重订阅在途 run」的窗口为真（区别于普通流式/思考），驱动「重连中…」锚点。
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [transportState, setTransportState] = useState<TransportState>("idle")
  // 权限档位：会话级全局（仿 Claude Code），默认 auto；可随时切，作用于下一轮 run。
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto")

  const replyHandleRef = useRef<LiveSessionHandle | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
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

  useSessionReattach({
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
  })

  const hasMessages = thread.messages.length > 0
  const hasFailed = thread.runStatus === "failed" && !isStreaming
  const presentation = modePresentation(
    mode,
    hasFailed ? "failed" : transportState,
    isStreaming,
    hasMessages,
  )

  // 发起一轮回复的共用核心（submit 与 retry 共享）：关旧句柄、推入流式态、贴底、交给编排器。
  const beginReply = useCallback(
    (content: string, seededThread: SessionStreamState, storeAtStart: ConversationStore) => {
      lastInputRef.current = content

      replyHandleRef.current?.close()
      setLiveStore(storeAtStart)
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
        onSettled: (mode: ReplyMode) => {
          requestInFlightRef.current = false
          setIsStreaming(false)
          setTransportState(mode)
          // run 落定：清除在途标记，刷新后不再尝试重连。
          setLiveStore((prev) => (prev ? setActivePending(prev, undefined) : prev))
          composerRef.current?.focus()
        },
      })
    },
    [mode, permissionMode, scrollToLatest, startReply, setLiveStore],
  )

  const submit = useCallback(
    (raw: string) => {
      const content = raw.trim()

      if (
        !content ||
        isStreaming ||
        requestInFlightRef.current ||
        content.length > MAX_INPUT_LENGTH
      ) {
        return
      }

      requestInFlightRef.current = true

      const now = nowMs()
      // 无 store（首次交互）则即时创建首个会话；否则在当前活跃会话上追加。
      const base = store ?? {
        activeId: createLocalId("conv"),
        conversations: [],
      }
      const baseStore: ConversationStore = store
        ? base
        : addConversation(null, base.activeId, now, pendingMode)
      const seeded = appendUserMessage(activeThreadOf(baseStore), {
        id: createLocalId("usr"),
        content,
      })
      const started = withActiveThread(baseStore, seeded, now)

      setDraft("")
      const composer = composerRef.current
      if (composer) {
        composer.style.height = "auto"
        composer.focus()
      }

      beginReply(content, seeded, started)
    },
    [beginReply, isStreaming, store, pendingMode],
  )

  const retry = useCallback(() => {
    if (
      isStreaming ||
      requestInFlightRef.current ||
      !lastInputRef.current ||
      !store
    ) {
      return
    }

    requestInFlightRef.current = true
    const resetThread: SessionStreamState = {
      ...activeThreadOf(store),
      runStatus: "idle",
    }
    const started = withActiveThread(store, resetThread, nowMs())
    beginReply(lastInputRef.current, resetThread, started)
  }, [beginReply, isStreaming, store])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit(draft)
  }

  const { cancelActiveRun, sendToolDecision } = useHitlControl({
    activeId,
    isStreaming,
    nowMs,
    persistedStore,
    replyHandleRef,
    setLiveStore,
    store,
  })

  const stopReply = useCallback(() => {
    void cancelActiveRun().catch(() => {})
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    setIsStreaming(false)
    setIsReconnecting(false)
    setTransportState("idle")
    // 手动中止也清除在途标记：刷新后不再自动重连这一轮。
    setLiveStore((prev) => (prev ? setActivePending(prev, undefined) : prev))
  }, [cancelActiveRun, setLiveStore])

  const startNewChat = useCallback(() => {
    // 新对话：中止在途回复，向 store 追加一个空会话并置为活跃，清空输入与瞬态标签。
    void cancelActiveRun().catch(() => {})
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    reattachedRef.current = null
    const id = createLocalId("conv")
    const now = nowMs()
    setLiveStore((prev) => addConversation(prev ?? persistedStore, id, now))
    setDraft("")
    setIsStreaming(false)
    setIsReconnecting(false)
    setTransportState("idle")
    composerRef.current?.focus()
  }, [persistedStore, cancelActiveRun, setLiveStore])

  const selectConversation = useCallback(
    (id: string) => {
      // 切换会话：中止在途回复（避免旧流折进新会话），清空瞬态态。
      replyHandleRef.current?.close()
      replyHandleRef.current = null
      requestInFlightRef.current = false
      // 允许切到（含切回）有在途 run 的会话时重新续传。
      reattachedRef.current = null
      setLiveStore((prev) => {
        const current = prev ?? persistedStore
        return current ? selectConversationOp(current, id) : current
      })
      setDraft("")
      setIsStreaming(false)
      setIsReconnecting(false)
      setTransportState("idle")
      composerRef.current?.focus()
    },
    [persistedStore, setLiveStore],
  )

  const deleteConversation = useCallback(
    (id: string) => {
      // 删除活跃会话时先中止在途回复。删空则自动起一个新的空会话。
      if (activeId === id) {
        void cancelActiveRun().catch(() => {})
        replyHandleRef.current?.close()
        replyHandleRef.current = null
        requestInFlightRef.current = false
        setIsStreaming(false)
        setIsReconnecting(false)
        setTransportState("idle")
      }
      const fallbackId = createLocalId("conv")
      const now = nowMs()
      setLiveStore((prev) => {
        const current = prev ?? persistedStore
        return current
          ? removeConversation(current, id, fallbackId, now)
          : current
      })
    },
    [activeId, persistedStore, cancelActiveRun, setLiveStore],
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送 / Shift+Enter 换行；IME 合成期（拼音选词）的 Enter 只确认候选词，不发送。
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit(draft)
    }
  }

  const canSend = draft.trim().length > 0 && !isStreaming

  return {
    thread,
    draft,
    setDraft,
    isStreaming,
    isReconnecting,
    transportLabel: presentation.transportLabel,
    presentation,
    composerRef,
    retry,
    stopReply,
    startNewChat,
    handleSubmit,
    handleKeyDown,
    canSend,
    hasMessages,
    hasFailed,
    conversations,
    activeId,
    selectConversation,
    deleteConversation,
    mode,
    setMode,
    modeLocked,
    permissionMode,
    setPermissionMode,
    sendToolDecision,
  }
}
