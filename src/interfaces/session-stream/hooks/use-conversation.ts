import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  type ConversationStore,
  activeThreadOf,
  addConversation,
  parseStoredConversationStore,
  removeConversation,
  selectConversation as selectConversationOp,
  sortedConversations,
  withActiveThread,
} from "@/application/conversation-store"
import {
  createLocalId,
  resolveSessionBaseUrl,
  type LiveSessionHandle,
  type ReplyMode,
  type StartReply,
} from "@/application/session-stream-preview"
import {
  appendUserMessage,
  createSessionStreamState,
  type SessionStreamState,
} from "@/application/session-stream-reducer"

// 多会话持久化键：落地整个会话 store（列表 + 活跃项），刷新后据此恢复。
const STORAGE_KEY = "kokoro:conversations"

// 输入上限：在发起任何网络/模拟之前就拦截超长草稿，避免把畸形大载荷推下游。
// 同步作为 textarea 的 maxLength，与 submit 守卫双重把关。
export const MAX_INPUT_LENGTH = 4000

// 持久化种子作为外部 store 读取：useSyncExternalStore 在 SSR 用 server 快照（null），
// 水合首帧与服务端一致（空首屏），随后切到客户端快照恢复——既无 hydration mismatch，
// 也无需在 effect 里 setState。快照必须按原始字符串缓存出稳定引用，否则 React 会判定
// 快照恒变而抛无限循环告警。
let cachedRaw: string | null = null
let cachedSeed: ConversationStore | null = null

function readPersistedStore(): ConversationStore | null {
  if (typeof window === "undefined") {
    return null
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)

  if (raw === cachedRaw) {
    return cachedSeed
  }

  cachedRaw = raw

  if (raw === null) {
    cachedSeed = null
    return null
  }

  try {
    cachedSeed = parseStoredConversationStore(JSON.parse(raw))
  } catch {
    // 损坏的 JSON 直接放过：种子降级为 null，停留在空首屏，绝不因脏数据崩溃。
    cachedSeed = null
  }

  return cachedSeed
}

// 自适应高度：先归零再贴合 scrollHeight，CSS 的 max-height: 7rem 负责硬顶 + 滚动。
// jsdom 下 scrollHeight 恒为 0，仍照常赋值（不抛错），rows={1} 作为无 JS 的兜底。
export function resizeComposer(node: HTMLTextAreaElement) {
  node.style.height = "auto"
  node.style.height = `${node.scrollHeight}px`
}

function subscribePersistedStore(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  // 仅订阅跨标签页的 storage 事件；同标签页内的写入由 React 状态自身驱动。
  window.addEventListener("storage", onChange)
  return () => window.removeEventListener("storage", onChange)
}

export type ConversationSummary = {
  id: string
  title: string
}

type Conversation = {
  thread: SessionStreamState
  draft: string
  setDraft: (value: string) => void
  prefillDraft: (value: string) => void
  isStreaming: boolean
  transportLabel: string
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
}

function nowMs(): number {
  // 仅在用户动作（提交/新建/切换）里调用，不在 render —— 不引入 SSR 注水抖动。
  return Date.now()
}

export function useConversation(
  startReply: StartReply,
  scrollToLatest: () => void,
): Conversation {
  // 持久化种子：水合后才出现，作为会话 store 的初始值。
  const persistedStore = useSyncExternalStore(
    subscribePersistedStore,
    readPersistedStore,
    () => null,
  )
  // 本会话内的所有变更都落在 liveStore；一旦出现就盖过种子。
  const [liveStore, setLiveStore] = useState<ConversationStore | null>(null)
  const store = liveStore ?? persistedStore

  const [draft, setDraft] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [transportLabel, setTransportLabel] = useState("")

  const replyHandleRef = useRef<LiveSessionHandle | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  // 同步在途守卫：isStreaming 是异步 UI 态，两次同步 submit 可能都读到旧值而双发。
  const requestInFlightRef = useRef(false)
  // 保留最近一次用户输入：失败后据此重试同一句，用户无需重新打字。
  const lastInputRef = useRef("")

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

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(liveStore))
  }, [liveStore])

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

  // 发起一轮回复的共用核心：关掉旧句柄、把起点 store 推入流式态、强制贴底跟随，
  // 再交给编排器。onState 把流入的线程折回活跃会话。submit 与 retry 共享它。
  const beginReply = useCallback(
    (content: string, seededThread: SessionStreamState, storeAtStart: ConversationStore) => {
      lastInputRef.current = content

      replyHandleRef.current?.close()
      setLiveStore(storeAtStart)
      setIsStreaming(true)
      scrollToLatest()

      replyHandleRef.current = startReply({
        input: content,
        initialState: seededThread,
        onState: (next: SessionStreamState) => {
          setLiveStore((prev) =>
            withActiveThread(prev ?? storeAtStart, next, nowMs()),
          )
        },
        onSettled: (mode: ReplyMode) => {
          requestInFlightRef.current = false
          setIsStreaming(false)
          setTransportLabel(
            mode === "live" ? `实时 · ${resolveSessionBaseUrl()}` : "本地预览",
          )
          composerRef.current?.focus()
        },
      })
    },
    [scrollToLatest, startReply],
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
        : addConversation(null, base.activeId, now)
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
    [beginReply, isStreaming, store],
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

  const stopReply = useCallback(() => {
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    setIsStreaming(false)
  }, [])

  const startNewChat = useCallback(() => {
    // 新对话：中止在途回复，向 store 追加一个空会话并置为活跃，清空输入与瞬态标签。
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    const id = createLocalId("conv")
    const now = nowMs()
    setLiveStore((prev) => addConversation(prev ?? persistedStore, id, now))
    setDraft("")
    setIsStreaming(false)
    setTransportLabel("")
    composerRef.current?.focus()
  }, [persistedStore])

  const selectConversation = useCallback(
    (id: string) => {
      // 切换会话：中止在途回复（避免旧流折进新会话），清空瞬态态。
      replyHandleRef.current?.close()
      replyHandleRef.current = null
      requestInFlightRef.current = false
      setLiveStore((prev) => {
        const current = prev ?? persistedStore
        return current ? selectConversationOp(current, id) : current
      })
      setDraft("")
      setIsStreaming(false)
      setTransportLabel("")
      composerRef.current?.focus()
    },
    [persistedStore],
  )

  const deleteConversation = useCallback(
    (id: string) => {
      // 删除活跃会话时先中止在途回复。删空则自动起一个新的空会话。
      if (activeId === id) {
        replyHandleRef.current?.close()
        replyHandleRef.current = null
        requestInFlightRef.current = false
        setIsStreaming(false)
        setTransportLabel("")
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
    [activeId, persistedStore],
  )

  const prefillDraft = useCallback((value: string) => {
    // 起始 chips 预填：填入草稿并聚焦，光标移到末尾便于直接续写。
    setDraft(value)
    const focusEnd = () => {
      const composer = composerRef.current
      if (!composer) {
        return
      }
      composer.focus()
      composer.setSelectionRange(value.length, value.length)
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(focusEnd)
    } else {
      focusEnd()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行——贴近主流对话输入习惯。
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit(draft)
    }
  }

  const canSend = draft.trim().length > 0 && !isStreaming

  return {
    thread,
    draft,
    setDraft,
    prefillDraft,
    isStreaming,
    transportLabel,
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
  }
}
