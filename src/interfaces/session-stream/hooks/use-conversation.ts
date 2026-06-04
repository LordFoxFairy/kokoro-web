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
  createLocalId,
  resolveSessionBaseUrl,
  type LiveSessionHandle,
  type ReplyMode,
  type StartReply,
} from "@/application/session-stream-preview"
import {
  appendUserMessage,
  createSessionStreamState,
  parseStoredSessionState,
  type SessionStreamState,
} from "@/application/session-stream-reducer"

// 单一持久化键：只落地耐久的会话线，刷新后据此恢复。
const STORAGE_KEY = "kokoro:session-thread"

// 输入上限：在发起任何网络/模拟之前就拦截超长草稿，避免把畸形大载荷推下游。
// 同步作为 textarea 的 maxLength，与 submit 守卫双重把关。
export const MAX_INPUT_LENGTH = 4000

// 持久化种子作为外部 store 读取：useSyncExternalStore 在 SSR 用 server 快照（null），
// 水合首帧与服务端一致（空首屏），随后切到客户端快照恢复——既无 hydration mismatch，
// 也无需在 effect 里 setState。快照必须按原始字符串缓存出稳定引用，否则 React 会判定
// 快照恒变而抛无限循环告警。
let cachedRaw: string | null = null
let cachedSeed: SessionStreamState | null = null

function readPersistedSeed(): SessionStreamState | null {
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
    cachedSeed = parseStoredSessionState(JSON.parse(raw))
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

function subscribePersistedSeed(onChange: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {}
  }

  // 仅订阅跨标签页的 storage 事件；同标签页内的写入由 React 状态自身驱动。
  window.addEventListener("storage", onChange)
  return () => window.removeEventListener("storage", onChange)
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
}

export function useConversation(
  startReply: StartReply,
  scrollToLatest: () => void,
): Conversation {
  // 持久化种子：水合后才出现，作为会话线的初始值。
  const persistedSeed = useSyncExternalStore(
    subscribePersistedSeed,
    readPersistedSeed,
    () => null,
  )
  // 本轮内的所有变更（发送 / 流式 / 重置）都落在 liveThread；一旦非空就盖过种子。
  const [liveThread, setLiveThread] = useState<SessionStreamState | null>(null)
  const thread = liveThread ?? persistedSeed ?? createSessionStreamState()

  const [draft, setDraft] = useState("")
  const [isStreaming, setIsStreaming] = useState(false)
  const [transportLabel, setTransportLabel] = useState("")

  const replyHandleRef = useRef<LiveSessionHandle | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  // 同步在途守卫：isStreaming 是异步 UI 态，两次同步 submit 可能都读到旧值而双发。
  // 这个 ref 在 submit 起点同步置位、settle 时清除，确保同步连发只起一条回复。
  const requestInFlightRef = useRef(false)
  // 保留最近一次用户输入：失败后据此重试同一句，用户无需重新打字。
  const lastInputRef = useRef("")

  useEffect(() => {
    return () => {
      replyHandleRef.current?.close()
    }
  }, [])

  // 会话线变化即落盘：只持久化耐久状态（不含 draft/streaming/transportLabel）。
  // 仅在 liveThread 出现后写入——种子本就来自存储，无需把它原样回写。
  useEffect(() => {
    if (typeof window === "undefined" || liveThread === null) {
      return
    }

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(liveThread))
  }, [liveThread])

  const hasMessages = thread.messages.length > 0
  const hasFailed = thread.runStatus === "failed" && !isStreaming

  // 发起一轮回复的共用核心：关掉旧句柄、把起点 thread 推入流式态、强制贴底跟随，
  // 再交给编排器。submit 与 retry 共享它，避免两处逻辑漂移。
  const beginReply = useCallback(
    (content: string, startThread: SessionStreamState) => {
      lastInputRef.current = content

      replyHandleRef.current?.close()
      setLiveThread(startThread)
      setIsStreaming(true)
      // 用户主动发起的一轮总是把视图拉回最新并收起“回到最新”入口。
      scrollToLatest()

      replyHandleRef.current = startReply({
        input: content,
        initialState: startThread,
        onState: setLiveThread,
        onSettled: (mode: ReplyMode) => {
          requestInFlightRef.current = false
          setIsStreaming(false)
          setTransportLabel(
            mode === "live" ? `实时 · ${resolveSessionBaseUrl()}` : "本地预览",
          )
          // 回复落定后焦点回到输入框，用户可直接继续打字。
          composerRef.current?.focus()
        },
      })
    },
    [scrollToLatest, startReply],
  )

  const submit = useCallback(
    (raw: string) => {
      const content = raw.trim()

      // requestInFlightRef 同步拦截连发；length 上限在网络前拒绝超长草稿。
      if (
        !content ||
        isStreaming ||
        requestInFlightRef.current ||
        content.length > MAX_INPUT_LENGTH
      ) {
        return
      }

      requestInFlightRef.current = true

      // 用户气泡本地立即落入持久 thread，再把这条 thread 作为本轮起点交给编排器。
      const seeded = appendUserMessage(thread, {
        id: createLocalId("usr"),
        content,
      })

      setDraft("")

      // 草稿清空后把高度收回单行，并把焦点还给输入框——保持键盘连续输入流。
      const composer = composerRef.current
      if (composer) {
        composer.style.height = "auto"
        composer.focus()
      }

      beginReply(content, seeded)
    },
    [beginReply, isStreaming, thread],
  )

  const retry = useCallback(() => {
    // 失败后重试：复用保留的上一句输入与当前会话线（用户气泡已在其中），
    // 不重新追加气泡。把 runStatus 拨回 idle，使错误提示在重试成功后消失。
    if (isStreaming || requestInFlightRef.current || !lastInputRef.current) {
      return
    }

    requestInFlightRef.current = true
    beginReply(lastInputRef.current, { ...thread, runStatus: "idle" })
  }, [beginReply, isStreaming, thread])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submit(draft)
  }

  const stopReply = useCallback(() => {
    // 中止在途回复：关闭 EventSource/计时器，但保留已收到的增量气泡，
    // 仅退出 streaming 态让输入框恢复可用。replyHandleRef 已为 null 时优雅放过。
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    setIsStreaming(false)
  }, [])

  const startNewChat = useCallback(() => {
    // 新对话：先中止在途回复，再把会话线归零回空首屏，清空输入与瞬态标签，
    // 最后把焦点交还给输入框，让用户可以立刻开始下一段对话。
    replyHandleRef.current?.close()
    replyHandleRef.current = null
    requestInFlightRef.current = false
    setLiveThread(createSessionStreamState())
    setDraft("")
    setIsStreaming(false)
    setTransportLabel("")
    composerRef.current?.focus()
  }, [])

  const prefillDraft = useCallback((value: string) => {
    // 起始 chips 预填：填入草稿并聚焦，光标移到末尾便于直接续写。
    // value 在下一帧才落进受控 textarea，故光标定位放到 rAF 后执行。
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
  }
}
