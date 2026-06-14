"use client"

import { type CSSProperties, useCallback, useRef, useState } from "react"

import { computeActivityVersion } from "@/application/session-stream/reducer"
import {
  startSessionReply,
  type StartReply,
} from "@/application/session-stream/reply"

import { Composer } from "./components/composer/composer"
import { ConversationThread } from "./components/thread/conversation-thread"
import { SessionRail } from "./components/session-rail"
import { TodoBar } from "./components/todo-bar"
import { useAutoScroll } from "./hooks/use-auto-scroll"
import { useConversation, type ReattachReply } from "./hooks/use-conversation"
import { useHydrated } from "./hooks/use-hydrated"
import { useRailResize } from "./hooks/use-rail-resize"

type SessionShellProps = {
  // 注入点：默认走真实 kokoro-session（后端缺席则本地模拟），测试可注入同步桩。
  startReply?: StartReply
  // 中断恢复的重连接口（默认重订阅真实 SSE）；测试可注入同步桩。
  reattach?: ReattachReply
}

export function SessionShell({
  startReply = startSessionReply,
  reattach,
}: SessionShellProps = {}) {
  // 水合后才渲染主内容：rail 与 composer 立即就位，会话线随后淡入。
  const mounted = useHydrated()

  const [railCollapsed, setRailCollapsed] = useState(false)

  // 侧栏可拖拽改宽（两侧自由，均有最小宽度）；收起态用固定窄列，不参与拖拽。
  const { width: railWidth, isResizing, shellRef, onResizeStart } =
    useRailResize()

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
    isStreaming,
    isReconnecting,
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
  } = useConversation(startReply, scrollToLatestSeam, reattach)

  // 过程块静默生长（思考/工具/子智能体流入，messages 引用不变）也要驱动贴底跟随：
  // 纯派生数，随活动总量单调增大，作为 auto-scroll 跟随 effect 的额外依赖。
  const activityVersion = computeActivityVersion(thread)

  const { threadEndRef, isNearBottom, scrollToLatest, handleThreadScroll } =
    useAutoScroll(
      thread.messages,
      isStreaming,
      scrollToLatestRef,
      activityVersion,
    )

  // 上滑阅读历史时若有新内容到来，浮出“回到最新”入口；贴底跟随时不出现。
  const showJumpToLatest = hasMessages && !isNearBottom

  return (
    <main
      ref={shellRef}
      className="kk-shell"
      data-run-status={thread.runStatus}
      data-transport-label={presentation.transportLabel}
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
        onDeleteConversation={deleteConversation}
      />

      {/* 拖拽分隔条：调整 rail/main 宽度（两侧自由、各有最小宽度）；收起态不可拖。 */}
      {!railCollapsed ? (
        <div
          className="kk-rail__resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧栏宽度"
          onPointerDown={onResizeStart}
        />
      ) : null}

      <section className="kk-shell__main">
        {!mounted ? (
          <div className="kk-shell__stage" aria-hidden />
        ) : hasMessages ? (
          <ConversationThread
            thread={thread}
            isStreaming={isStreaming}
            isReconnecting={isReconnecting}
            hasFailed={hasFailed}
            onRetry={retry}
            onScroll={handleThreadScroll}
            threadEndRef={threadEndRef}
            mode={mode}
          />
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

        {/* 计划条钉在输入框正上方，可收缩；对话流里的思考/工具/子智能体在 ConversationThread 内联呈现。 */}
        {mounted ? <TodoBar todos={thread.todos} /> : null}

        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onKeyDown={handleKeyDown}
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          canSend={canSend}
          onStop={stopReply}
          transportLabel={presentation.transportLabel}
          modeHint={presentation.modeHint}
          composerRef={composerRef}
          mode={mode}
          onModeChange={setMode}
          modeLocked={modeLocked}
          permissionMode={permissionMode}
          onPermissionModeChange={setPermissionMode}
        />
      </section>
    </main>
  )
}
