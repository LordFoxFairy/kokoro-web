"use client"

// 装配层：页面级单例持有引擎，useSessionEngine 订阅快照，把纯投影接线到各 UI 域。

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { activeMode, sortedConversations } from "@/core/conversations"
import { storedConversationStoreSchema } from "@/core/persistence"
import { previewClientFromEnv } from "@/dev/preview-transport"
import { createSessionClient } from "@/engine/client"
import { sessionBaseUrl } from "@/engine/config"
import { createSessionEngine, type SessionEngine } from "@/engine/machine"
import { useSessionEngine } from "@/engine/use-session-engine"
import { createPersistedStore } from "@/lib/persisted-store"
import { useHydrated } from "@/lib/use-hydrated"

import { Composer, MAX_INPUT_LENGTH } from "@/ui/composer/composer"
import { modePresentation } from "@/ui/composer/mode-options"
import { SessionRail } from "@/ui/rail/session-rail"
import { useRailResize } from "@/ui/rail/use-rail-resize"
import { ConversationThread } from "@/ui/thread/conversation-thread"
import { useAutoScroll } from "@/ui/thread/use-auto-scroll"
import { TodoBar } from "@/ui/todo/todo-bar"

import styles from "./session-shell.module.css"

const STORAGE_KEY = "kokoro.web.conversations"

// 页面级单例：整页共享一个引擎实例（含流句柄与重连计时器），仅浏览器创建，SSR 为 null。
let pageEngine: SessionEngine | null = null

function browserEngine(): SessionEngine | null {
  if (typeof window === "undefined") {
    return null
  }
  if (!pageEngine) {
    // 显式 env 开关的开发假流优先；否则走真实 kokoro-session（base URL 缺失即 fail-loud）。
    const client = previewClientFromEnv() ?? createSessionClient({ baseUrl: sessionBaseUrl() })
    pageEngine = createSessionEngine({
      client,
      storage: createPersistedStore({
        key: STORAGE_KEY,
        schema: storedConversationStoreSchema,
      }),
    })
  }
  return pageEngine
}

// 新对话快捷键 ⇧⌘O（mac）/ ⇧Ctrl O（其它平台）：与侧栏展示的提示一致。
function isNewChatShortcut(event: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): boolean {
  return (
    (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o"
  )
}

type SessionShellProps = {
  // 测试注入缝：不传则使用页面级单例引擎。
  engine?: SessionEngine | null
}

export function SessionShell({ engine: injectedEngine }: SessionShellProps = {}) {
  const engine = injectedEngine !== undefined ? injectedEngine : browserEngine()
  const snapshot = useSessionEngine(engine)
  const { machine, store, thread, pendingMode, staging } = snapshot

  // 水合后才渲染主内容：rail 与 composer 立即就位，会话线随后淡入。
  const mounted = useHydrated()

  const [railCollapsed, setRailCollapsed] = useState(false)
  const [draft, setDraft] = useState("")
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  // 侧栏可拖拽改宽（两侧自由，均有最小宽度）；收起态用固定窄列，不参与拖拽。
  const { width: railWidth, isResizing, shellRef, onResizeStart } = useRailResize()

  const isStreaming = machine.phase !== "idle" && machine.phase !== "error"
  const isReconnecting = machine.phase === "reattaching"
  const hasMessages = thread.messages.length > 0
  // 失败双源：client/机器错误态（machine.error）与 agent 裁决的 run.failed 终态，都显式呈现。
  const hasFailed = !isStreaming && (machine.phase === "error" || thread.runStatus === "failed")

  const mode = store ? activeMode(store) : pendingMode
  // 已开聊即锁定：线程有消息（本地追加或 snapshot 水合）后模式不可再切换。
  const modeLocked = thread.messages.length > 0
  const conversations = store
    ? sortedConversations(store).map((entry) => ({ id: entry.id, title: entry.title }))
    : []
  const activeId = store?.activeId ?? null

  const presentation = modePresentation(
    mode,
    hasFailed ? "failed" : machine.phase,
    hasMessages,
  )

  const focusComposer = useCallback(() => {
    const node = composerRef.current
    if (node) {
      node.style.height = "auto"
      node.focus()
    }
  }, [])

  const submitDraft = useCallback(() => {
    const content = draft.trim()
    if (!engine || !content || content.length > MAX_INPUT_LENGTH) {
      return
    }
    // 流式中提交=运行中插话（engine 识别活跃相位走 steer，不打断本轮）。
    engine.submit(content)
    setDraft("")
    focusComposer()
  }, [draft, engine, focusComposer])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    submitDraft()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter 发送 / Shift+Enter 换行；IME 合成期（拼音选词）的 Enter 只确认候选词，不发送。
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submitDraft()
    }
  }

  const startNewChat = useCallback(() => {
    engine?.newConversation()
    setDraft("")
    focusComposer()
  }, [engine, focusComposer])

  const selectConversation = useCallback(
    (id: string) => {
      engine?.selectConversation(id)
      setDraft("")
      focusComposer()
    },
    [engine, focusComposer],
  )

  // 新对话快捷键 ⇧⌘O（侧栏展示该提示，故全局接入键盘使其真实可用）。
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isNewChatShortcut(event)) {
        event.preventDefault()
        startNewChat()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [startNewChat])

  // 事件到达（thread 引用更新）即滚动信号：不再做全量字符扫描。
  const { threadEndRef, isNearBottom, scrollToLatest, handleThreadScroll } = useAutoScroll(
    thread,
    isStreaming,
  )

  // 上滑阅读历史时若有新内容到来，浮出「回到最新」入口；贴底跟随时不出现。
  const showJumpToLatest = hasMessages && !isNearBottom

  const canSend = draft.trim().length > 0

  return (
    <main
      ref={shellRef}
      className={styles.shell}
      data-rail-collapsed={railCollapsed ? "true" : "false"}
      data-resizing={isResizing ? "true" : undefined}
      style={{ "--kk-rail-width": `${railWidth}px` } as CSSProperties}
    >
      <SessionRail
        collapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((value) => !value)}
        onNewChat={startNewChat}
        conversations={conversations}
        activeId={activeId}
        onSelectConversation={selectConversation}
        onDeleteConversation={(id) => engine?.deleteConversation(id)}
      />

      {/* 拖拽分隔条：调整 rail/main 宽度（两侧自由、各有最小宽度）；收起态不可拖。 */}
      {!railCollapsed ? (
        <div
          className={styles.resizer}
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          onPointerDown={onResizeStart}
        />
      ) : null}

      <section className={styles.main}>
        {!mounted ? (
          <div className={styles.stage} aria-hidden />
        ) : hasMessages ? (
          <ConversationThread
            sessionId={activeId}
            thread={thread}
            isStreaming={isStreaming}
            isReconnecting={isReconnecting}
            hasFailed={hasFailed}
            onRetry={() => engine?.retry()}
            onScroll={handleThreadScroll}
            threadEndRef={threadEndRef}
            mode={mode}
            stagingByRun={staging}
            hitlRunId={machine.phase === "awaiting-hitl" ? machine.runId : null}
            controlError={machine.phase === "awaiting-hitl" ? machine.error : null}
            onToolDecision={(runId, toolId, decision) =>
              engine?.stageToolDecision(runId, toolId, decision)
            }
            onCancelRun={() => engine?.cancelRun()}
          />
        ) : (
          <div className={styles.hero}>
            <h1 className={styles.headline}>今天想做什么？</h1>
            <p className={styles.subhead}>不急，先把想法说给我</p>
          </div>
        )}

        {showJumpToLatest ? (
          <button className={styles.jump} type="button" onClick={scrollToLatest}>
            <span aria-hidden>↓</span>
            <span>回到最新</span>
          </button>
        ) : null}

        {/* 计划条钉在输入框正上方，可收缩；思考/工具/子智能体在 ConversationThread 内联呈现。 */}
        {mounted ? <TodoBar todos={thread.todos} /> : null}

        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onKeyDown={handleKeyDown}
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          canSend={canSend}
          onStop={() => engine?.cancelRun()}
          transportLabel={presentation.transportLabel}
          modeHint={presentation.modeHint}
          composerRef={composerRef}
          mode={mode}
          onModeChange={(next) => engine?.setMode(next)}
          modeLocked={modeLocked}
        />
      </section>
    </main>
  )
}
