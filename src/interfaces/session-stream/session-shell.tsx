"use client"

import {
  type FormEvent,
  type KeyboardEvent,
  type UIEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"

import {
  createLocalId,
  resolveSessionBaseUrl,
  startSessionReply,
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
const MAX_INPUT_LENGTH = 4000

// 贴底阈值：距底不足这个像素就视为“跟随”，新增内容才继续自动滚动。
// 留一点余量，避免 1px 误差或子像素让跟随态在贴底时反复抖动。
const NEAR_BOTTOM_THRESHOLD = 64

function isThreadNearBottom(node: HTMLDivElement): boolean {
  return node.scrollTop >= node.scrollHeight - node.clientHeight - NEAR_BOTTOM_THRESHOLD
}

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
function resizeComposer(node: HTMLTextAreaElement) {
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

// 水合探针：无订阅、稳定快照；配合 useSyncExternalStore 判定客户端首帧后状态。
function subscribeNoop(): () => void {
  return () => {}
}

type SessionShellProps = {
  // 注入点：默认走真实 kokoro-session（后端缺席则本地模拟），测试可注入同步桩。
  startReply?: StartReply
}

export function SessionShell({
  startReply = startSessionReply,
}: SessionShellProps = {}) {
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
  const [railCollapsed, setRailCollapsed] = useState(false)
  // 水合后才渲染主内容：rail 与 composer 立即就位，会话线随后淡入。
  // 服务端与首帧客户端一致（空占位），消除“空首屏→恢复历史”的刷新闪跳。
  // 用 useSyncExternalStore 取代 setState-in-effect：SSR/首帧为 false，水合后翻 true。
  const mounted = useSyncExternalStore(subscribeNoop, () => true, () => false)

  const replyHandleRef = useRef<LiveSessionHandle | null>(null)
  const threadEndRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  // 同步在途守卫：isStreaming 是异步 UI 态，两次同步 submit 可能都读到旧值而双发。
  // 这个 ref 在 submit 起点同步置位、settle 时清除，确保同步连发只起一条回复。
  const requestInFlightRef = useRef(false)
  // 保留最近一次用户输入：失败后据此重试同一句，用户无需重新打字。
  const lastInputRef = useRef("")
  // 用户是否贴近底部：贴底时跟随新内容滚动，上滑后不再被新内容拽回。
  // 同步镜像到 ref，供自动滚动 effect 读取最新值而不必把它列入依赖。
  const [isNearBottom, setIsNearBottom] = useState(true)
  const isNearBottomRef = useRef(true)

  const setNearBottom = useCallback((near: boolean) => {
    isNearBottomRef.current = near
    setIsNearBottom(near)
  }, [])

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

  const scrollToLatest = useCallback(() => {
    const node = threadEndRef.current

    if (node && typeof node.scrollIntoView === "function") {
      try {
        node.scrollIntoView({ block: "end" })
      } catch {
        // 无布局环境（如 jsdom）下忽略滚动，不影响状态流转。
      }
    }

    setNearBottom(true)
  }, [setNearBottom])

  // 仅在用户贴底时跟随新内容滚动；上滑阅读历史时不抢夺视图。
  // 贴底态从 ref 读取最新值，故只依赖会触发新内容的 messages/streaming。
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToLatest()
    }
  }, [thread.messages, isStreaming, scrollToLatest])

  const handleThreadScroll = (event: UIEvent<HTMLDivElement>) => {
    setNearBottom(isThreadNearBottom(event.currentTarget))
  }

  const hasMessages = thread.messages.length > 0
  const hasFailed = thread.runStatus === "failed" && !isStreaming
  // 上滑阅读历史时若有新内容到来，浮出“回到最新”入口；贴底跟随时不出现。
  const showJumpToLatest = hasMessages && !isNearBottom

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

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送，Shift+Enter 换行——贴近主流对话输入习惯。
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      submit(draft)
    }
  }

  const canSend = draft.trim().length > 0 && !isStreaming

  return (
    <main
      className="kk-shell"
      data-run-status={thread.runStatus}
      data-transport-label={transportLabel}
      data-rail-collapsed={railCollapsed ? "true" : "false"}
    >
      <aside className="kk-rail" aria-label="会话导航">
        <div className="kk-rail__head">
          <div className="kk-rail__brand">
            <div className="kk-rail__brand-mark" aria-hidden>
              心
            </div>
            <div className="kk-rail__brand-text">
              <p className="kk-rail__brand-title">Kokoro</p>
              <p className="kk-rail__brand-subtitle">こころ</p>
            </div>
          </div>

          <button
            className="kk-rail__collapse"
            type="button"
            onClick={() => setRailCollapsed((value) => !value)}
            aria-label={railCollapsed ? "展开侧栏" : "收起侧栏"}
            aria-expanded={!railCollapsed}
          >
            <svg className="kk-rail__icon" viewBox="0 0 24 24" fill="none" aria-hidden>
              <rect
                x="3"
                y="4"
                width="18"
                height="16"
                rx="2.5"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <line x1="9.5" y1="4" x2="9.5" y2="20" stroke="currentColor" strokeWidth="1.7" />
            </svg>
          </button>
        </div>

        <button
          className="kk-rail__action kk-rail__new-chat"
          type="button"
          onClick={startNewChat}
        >
          <svg className="kk-rail__icon" viewBox="0 0 24 24" fill="none" aria-hidden>
            <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="kk-rail__action-label">新对话</span>
        </button>

        <button className="kk-rail__action kk-rail__search" type="button">
          <span className="kk-rail__search-label">
            <svg className="kk-rail__icon" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
              <line x1="20" y1="20" x2="16.2" y2="16.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
            <span className="kk-rail__action-label">搜索</span>
          </span>
          <span className="kk-rail__search-shortcut">⌘K</span>
        </button>

        <div className="kk-rail__user-card">
          <div className="kk-rail__user-avatar" aria-hidden />
          <div className="kk-rail__user-text">
            <p className="kk-rail__user-name">当前用户</p>
            <p className="kk-rail__user-meta">本地会话</p>
          </div>
        </div>
      </aside>

      <section className="kk-shell__main">
        {!mounted ? (
          <div className="kk-shell__stage" aria-hidden />
        ) : hasMessages ? (
          <div
            className="kk-thread"
            role="log"
            aria-label="对话记录"
            aria-live="polite"
            onScroll={handleThreadScroll}
          >
            <div className="kk-thread__inner">
              {thread.messages.map((message, index) => {
                // 流式中正在生长的助手气泡用 aria-atomic 包成一个整体：
                // 每次增量按整段播报，而非把整条 log 重读一遍。其余历史气泡
                // 沿用 log 默认的“仅播报新增”，不被反复朗读。
                const isStreamingAssistant =
                  isStreaming &&
                  message.role === "assistant" &&
                  index === thread.messages.length - 1

                return (
                  <article
                    key={message.id}
                    className={`kk-msg kk-msg--${message.role}`}
                    aria-atomic={isStreamingAssistant ? true : undefined}
                  >
                    {message.role === "assistant" ? (
                      <div className="kk-msg__avatar" aria-hidden>
                        心
                      </div>
                    ) : null}
                    <div className="kk-msg__bubble">
                      <p className="kk-msg__body">{message.content}</p>
                    </div>
                  </article>
                )
              })}

              {isStreaming ? (
                <p className="kk-thread__status">
                  正在输入
                  <span className="kk-thread__pulse" aria-hidden>
                    <span />
                    <span />
                    <span />
                  </span>
                </p>
              ) : null}

              {hasFailed ? (
                <div className="kk-thread__error" role="alert">
                  <span>这一轮没能完成，稍后再试一次。</span>
                  <button
                    className="kk-thread__retry"
                    type="button"
                    onClick={retry}
                  >
                    重试
                  </button>
                </div>
              ) : null}

              <div ref={threadEndRef} />
            </div>
          </div>
        ) : (
          <div className="kk-shell__hero">
            <h1 className="kk-shell__headline">今天想做什么？</h1>
            <p className="kk-shell__subhead">不急，先把想法说给我</p>
          </div>
        )}

        {showJumpToLatest ? (
          <button
            className="kk-shell__jump"
            type="button"
            onClick={scrollToLatest}
          >
            <span aria-hidden>↓</span>
            <span>回到最新</span>
          </button>
        ) : null}

        <div className="kk-shell__composer-wrap">
          <form
            className="kk-composer"
            aria-label="消息编辑区"
            onSubmit={handleSubmit}
          >
            <button
              className="kk-composer__add"
              type="button"
              aria-label="附加内容"
            >
              <span aria-hidden>＋</span>
            </button>

            <textarea
              ref={composerRef}
              className="kk-composer__input"
              aria-label="对话输入"
              placeholder="把想说的告诉我。"
              rows={1}
              maxLength={MAX_INPUT_LENGTH}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                resizeComposer(event.currentTarget)
              }}
              onKeyDown={handleKeyDown}
              disabled={isStreaming}
            />

            <button
              className="kk-composer__mode"
              type="button"
              aria-label="切换模式"
            >
              <span>Fast</span>
              <span aria-hidden>▾</span>
            </button>

            <button className="kk-composer__mic" type="button" aria-label="语音输入">
              <span aria-hidden>◉</span>
            </button>

            {isStreaming ? (
              <button
                className="kk-composer__send kk-composer__send--stop"
                type="button"
                aria-label="停止生成"
                onClick={stopReply}
              >
                <span aria-hidden>■</span>
              </button>
            ) : (
              <button
                className="kk-composer__send"
                type="submit"
                aria-label="发送消息"
                disabled={!canSend}
              >
                <span aria-hidden>↑</span>
              </button>
            )}
          </form>

          {transportLabel ? (
            <p className="kk-shell__transport">{transportLabel}</p>
          ) : null}
        </div>
      </section>
    </main>
  )
}
