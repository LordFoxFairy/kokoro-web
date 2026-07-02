import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
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
import { createLocalId } from "@/application/session-stream/simulator"
import { type StartReply } from "@/application/session-stream/reply"
import {
  appendUserMessage,
  type SessionStreamState,
  type ToolDecision,
} from "@/application/session-stream/reducer"
import type { PermissionMode } from "@/application/session-stream/transport"

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
import { useTransportSession } from "./use-transport-session"
import { MAX_INPUT_LENGTH } from "../components/composer/composer-input"
import {
  modePresentation,
  type ModePresentation,
} from "./mode-presentation"

// 对外契约：消费组件从本模块导入这些类型，故在此再导出，保持公开 API 表面稳定。
export type { ConversationSummary } from "./use-conversation-store"
export type { ReattachReply } from "./use-session-reattach"

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
  // HITL：批准/拒绝某 run 某个待批工具。同帧多工具凑齐后统一提交一条 resume；control POST 失败时
  // Promise reject 让按钮层恢复可重试。
  sendToolDecision: (
    runId: string,
    toolId: string,
    decision: ToolDecision,
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
  // 权限档位：会话级全局（仿 Claude Code），默认 auto；可随时切，作用于下一轮 run。
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("auto")

  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  // 在途 run 句柄 + 瞬态机所有权全部收敛在 transport：本 hook 只负责编排。
  const transport = useTransportSession(
    startReply,
    scrollToLatest,
    mode,
    permissionMode,
    setLiveStore,
    nowMs,
  )
  const {
    isStreaming,
    isReconnecting,
    transportState,
    requestInFlightRef,
    lastInputRef,
    replyHandleRef,
  } = transport

  useSessionReattach({
    pendingConvId,
    store,
    reattach,
    nowMs,
    setLiveStore,
    transport,
  })

  const hasMessages = thread.messages.length > 0
  const hasFailed = thread.runStatus === "failed" && !isStreaming
  const presentation = modePresentation(
    mode,
    hasFailed ? "failed" : transportState,
    isStreaming,
    hasMessages,
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

      transport.start({ content, seededThread: seeded, storeAtStart: started })
    },
    [transport, isStreaming, requestInFlightRef, store, pendingMode],
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
    transport.start({
      content: lastInputRef.current,
      seededThread: resetThread,
      storeAtStart: started,
    })
  }, [transport, isStreaming, lastInputRef, requestInFlightRef, store])

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
    transport.resetTransient()
    // 手动中止也清除在途标记：刷新后不再自动重连这一轮。
    setLiveStore((prev) => (prev ? setActivePending(prev, undefined) : prev))
  }, [cancelActiveRun, setLiveStore, transport])

  const startNewChat = useCallback(() => {
    // 新对话：中止在途回复，向 store 追加一个空会话并置为活跃，清空输入与瞬态标签。
    void cancelActiveRun().catch(() => {})
    transport.resetTransient({ reattach: true })
    const id = createLocalId("conv")
    const now = nowMs()
    setLiveStore((prev) => addConversation(prev ?? persistedStore, id, now))
    setDraft("")
    composerRef.current?.focus()
  }, [persistedStore, cancelActiveRun, setLiveStore, transport])

  const selectConversation = useCallback(
    (id: string) => {
      // 切换会话：中止在途回复（避免旧流折进新会话），清空瞬态态，放开重连守卫以便续传。
      transport.resetTransient({ reattach: true })
      setLiveStore((prev) => {
        const current = prev ?? persistedStore
        return current ? selectConversationOp(current, id) : current
      })
      setDraft("")
      composerRef.current?.focus()
    },
    [persistedStore, setLiveStore, transport],
  )

  const deleteConversation = useCallback(
    (id: string) => {
      // 删除活跃会话时先中止在途回复。删空则自动起一个新的空会话。
      if (activeId === id) {
        void cancelActiveRun().catch(() => {})
        transport.resetTransient()
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
    [activeId, persistedStore, cancelActiveRun, setLiveStore, transport],
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
