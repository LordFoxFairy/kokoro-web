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
  activeMode,
  activeThreadOf,
  addConversation,
  isActiveModeLocked,
  removeConversation,
  selectConversation as selectConversationOp,
  serializeConversationStore,
  setActiveMode,
  setActivePending,
  sortedConversations,
  withActiveThread,
} from "@/application/conversation-store"
import {
  reattachLiveSession,
  sendRunControl,
  type LiveSessionHandle,
} from "@/application/session-stream/transport"
import { createLocalId } from "@/application/session-stream/simulator"
import {
  type ReplyMode,
  type StartReply,
} from "@/application/session-stream/reply"
import {
  appendUserMessage,
  createSessionStreamState,
  findActiveRunId,
  type SessionStreamState,
} from "@/application/session-stream/reducer"

import { STORAGE_KEY, usePersistentStore } from "./use-persistent-store"
import { MAX_INPUT_LENGTH } from "../components/composer/composer-input"
import {
  modePresentation,
  type ModePresentation,
  type TransportState,
} from "./mode-presentation"

export type ConversationSummary = {
  id: string
  title: string
}

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
  // HITL：批准/拒绝某 run 待批的工具调用。
  sendToolDecision: (runId: string, decision: "approve" | "reject") => void
}

function nowMs(): number {
  // 仅在用户动作（提交/新建/切换）里调用，不在 render —— 不引入 SSR 注水抖动。
  return Date.now()
}

// 中断恢复用的重连接口：不发新 POST，只重订阅某 session 的 SSE 续传。可注入以便测试。
export type ReattachReply = (args: {
  sessionId: string
  initialState: SessionStreamState
  onState: (snapshot: SessionStreamState) => void
  onSettled: () => void
}) => LiveSessionHandle

const defaultReattach: ReattachReply = (args) =>
  reattachLiveSession({
    sessionId: args.sessionId,
    initialState: args.initialState,
    onState: args.onState,
    onSettled: args.onSettled,
  })

// 重连兜底：若 90s 内未收到终态（后端已停/网络长断），放弃续传以免永久卡在 streaming。
const REATTACH_TIMEOUT_MS = 90_000

export function useConversation(
  startReply: StartReply,
  scrollToLatest: () => void,
  reattach: ReattachReply = defaultReattach,
): Conversation {
  // 持久化种子：水合后才出现，作为会话 store 的初始值。
  const persistedStore = usePersistentStore()
  // 本会话内的所有变更都落在 liveStore；一旦出现就盖过种子。
  const [liveStore, setLiveStore] = useState<ConversationStore | null>(null)
  const store = liveStore ?? persistedStore
  // 活跃会话是否有在途 live run（用于中断恢复）。在重连 effect 之前求出，避免 TDZ。
  const pendingConvId =
    store?.conversations.find((entry) => entry.id === store.activeId)
      ?.pendingInput
      ? store.activeId
      : null

  const [draft, setDraft] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  // 重连续传态：仅在「重订阅在途 run」的窗口为真（区别于普通流式/思考），驱动「重连中…」锚点。
  const [isReconnecting, setIsReconnecting] = useState(false)
  const [transportState, setTransportState] = useState<TransportState>("idle")
  // 空首屏（尚无会话）时选好的模式：首条消息创建首个会话时承接它。会话存在后模式以会话为准。
  const [pendingMode, setPendingMode] = useState<AgentMode>("fast")
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

  // 会话 store 变化即落盘；仅在 liveStore 出现后写入——种子本就来自存储，无需原样回写。
  useEffect(() => {
    if (typeof window === "undefined" || liveStore === null) {
      return
    }

    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(serializeConversationStore(liveStore)),
    )
  }, [liveStore])

  // 中断恢复：活跃会话有在途 run 时重订阅其 SSE 续传；每个 pending 会话只触发一次。
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
    /* eslint-disable react-hooks/set-state-in-effect */
    setIsStreaming(true)
    setIsReconnecting(true)
    setTransportState("live")
    /* eslint-enable react-hooks/set-state-in-effect */
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

  const thread = store ? activeThreadOf(store) : createSessionStreamState()
  const conversations: ConversationSummary[] = store
    ? sortedConversations(store).map((entry) => ({
        id: entry.id,
        title: entry.title,
      }))
    : []
  const activeId = store?.activeId ?? null
  const hasMessages = thread.messages.length > 0
  const hasFailed = thread.runStatus === "failed" && !isStreaming
  // 模式以活跃会话为准；尚无会话时用 pendingMode。开聊后锁定。
  const mode: AgentMode = store ? activeMode(store) : pendingMode
  const modeLocked = store ? isActiveModeLocked(store) : false
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
    [mode, permissionMode, scrollToLatest, startReply],
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

  const cancelActiveRun = useCallback(() => {
    // 放弃/停止在途 run：发 cancel 让 worker 取消整个 run（真停后端，不白烧 token；
    // 一并解阻塞所有待批门，不挂到 90s 超时）。仅在流式中才有在途 run 可取消。
    if (!store || !activeId || !isStreaming) {
      return
    }
    const rid = findActiveRunId(activeThreadOf(store))
    if (rid) {
      void sendRunControl({ sessionId: activeId, runId: rid, decision: "cancel" })
    }
  }, [store, activeId, isStreaming])

  const stopReply = useCallback(() => {
    cancelActiveRun()
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    setIsStreaming(false)
    setIsReconnecting(false)
    setTransportState("idle")
    // 手动中止也清除在途标记：刷新后不再自动重连这一轮。
    setLiveStore((prev) => (prev ? setActivePending(prev, undefined) : prev))
  }, [cancelActiveRun])

  const startNewChat = useCallback(() => {
    // 新对话：中止在途回复，向 store 追加一个空会话并置为活跃，清空输入与瞬态标签。
    cancelActiveRun()
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
  }, [persistedStore, cancelActiveRun])

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
    [persistedStore],
  )

  const deleteConversation = useCallback(
    (id: string) => {
      // 删除活跃会话时先中止在途回复。删空则自动起一个新的空会话。
      if (activeId === id) {
        cancelActiveRun()
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
    [activeId, persistedStore, cancelActiveRun],
  )

  const setMode = useCallback(
    (next: AgentMode) => {
      // 已开聊即锁定：忽略切换。无会话时落在 pendingMode，有会话时写入活跃会话。
      if (modeLocked) {
        return
      }
      if (store) {
        setLiveStore((prev) => {
          const current = prev ?? persistedStore
          return current ? setActiveMode(current, next) : current
        })
      } else {
        setPendingMode(next)
      }
    },
    [modeLocked, store, persistedStore],
  )

  const sendToolDecision = useCallback(
    (runId: string, decision: "approve" | "reject") => {
      // 后端 session id = 会话 id（与 startReply/transport 一致）。
      if (!activeId) {
        return
      }
      void sendRunControl({ sessionId: activeId, runId, decision })
      // reject 经门控工具以 is_error=false 回流（普通逻辑会翻绿勾 done）：让 live 句柄把该工具
      // 落进流的权威 state 为 rejected，后续 tool.returned 由 reducer 保留 rejected（显著区分）。
      if (decision === "reject") {
        replyHandleRef.current?.markToolRejected?.(runId)
      }
    },
    [activeId],
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
