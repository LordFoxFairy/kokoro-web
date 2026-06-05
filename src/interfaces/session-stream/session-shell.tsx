"use client"

import { useCallback, useRef, useState } from "react"

import {
  startSessionReply,
  type StartReply,
} from "@/application/session-stream-preview"

import { Composer } from "./components/composer"
import { ConversationThread } from "./components/conversation-thread"
import { SessionRail } from "./components/session-rail"
import { StarterChips } from "./components/starter-chips"
import { useAutoScroll } from "./hooks/use-auto-scroll"
import { useConversation } from "./hooks/use-conversation"
import { useHydrated } from "./hooks/use-hydrated"

type SessionShellProps = {
  // 注入点：默认走真实 kokoro-session（后端缺席则本地模拟），测试可注入同步桩。
  startReply?: StartReply
}

export function SessionShell({
  startReply = startSessionReply,
}: SessionShellProps = {}) {
  // 水合后才渲染主内容：rail 与 composer 立即就位，会话线随后淡入。
  const mounted = useHydrated()

  const [railCollapsed, setRailCollapsed] = useState(false)

  // 自动滚动依赖会话线，会话引擎的 beginReply 又需要 scrollToLatest：用 ref 打破环依赖。
  // useAutoScroll 在 effect 里把最新实现回填到该 ref，事件触发时读到的始终是当下的滚动逻辑。
  const scrollToLatestRef = useRef<() => void>(() => {})
  const scrollToLatestSeam = useCallback(() => {
    scrollToLatestRef.current()
  }, [])

  const {
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
  } = useConversation(startReply, scrollToLatestSeam)

  const { threadEndRef, isNearBottom, scrollToLatest, handleThreadScroll } =
    useAutoScroll(thread.messages, isStreaming, scrollToLatestRef)

  // 上滑阅读历史时若有新内容到来，浮出“回到最新”入口；贴底跟随时不出现。
  const showJumpToLatest = hasMessages && !isNearBottom

  return (
    <main
      className="kk-shell"
      data-run-status={thread.runStatus}
      data-transport-label={transportLabel}
      data-rail-collapsed={railCollapsed ? "true" : "false"}
    >
      <SessionRail
        collapsed={railCollapsed}
        onToggleCollapse={() => setRailCollapsed((value) => !value)}
        onNewChat={startNewChat}
      />

      <section className="kk-shell__main">
        {!mounted ? (
          <div className="kk-shell__stage" aria-hidden />
        ) : hasMessages ? (
          <ConversationThread
            messages={thread.messages}
            thinking={thread.thinking}
            todos={thread.todos}
            toolCalls={thread.toolCalls}
            subagents={thread.subagents}
            isStreaming={isStreaming}
            hasFailed={hasFailed}
            onRetry={retry}
            onScroll={handleThreadScroll}
            threadEndRef={threadEndRef}
          />
        ) : (
          <div className="kk-shell__hero">
            <h1 className="kk-shell__headline">今天想做什么？</h1>
            <p className="kk-shell__subhead">不急，先把想法说给我</p>
            <StarterChips onPick={prefillDraft} />
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

        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onKeyDown={handleKeyDown}
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          canSend={canSend}
          onStop={stopReply}
          transportLabel={transportLabel}
          composerRef={composerRef}
        />
      </section>
    </main>
  )
}
