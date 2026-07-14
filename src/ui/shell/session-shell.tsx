"use client"

// 装配层：页面级单例持有引擎，useSessionEngine 订阅快照，把纯投影接线到各 UI 域。每个能力域
// 抽为 controller hook（自持查询/store/回调，见相邻 use-*.ts + page-clients.ts）；本文件只做插槽
// 接线——布局/开合/快捷键在此收口，域内状态一律下沉。

import {
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"

import { activeMode, conversationTitle } from "@/core/conversations"
import { type SessionEngine } from "@/engine/machine"
import { useSessionEngine } from "@/engine/use-session-engine"
import { useT } from "@/i18n/context"

import { useHydrated } from "@/lib/use-hydrated"

import { isCreditInsufficient } from "@/billing/rules"
import { Composer, MAX_INPUT_LENGTH } from "@/ui/composer/composer"
import { modePresentation } from "@/ui/composer/mode-options"
import { HeaderTitle } from "@/ui/shell/header-title"
import { SessionRail } from "@/ui/rail/session-rail"
import { ShareButton } from "@/ui/share/share-button"
import { useRailResize } from "@/ui/rail/use-rail-resize"
import { ConversationThread } from "@/ui/thread/conversation-thread"
import { useAutoScroll } from "@/ui/thread/use-auto-scroll"
import { TodoBar } from "@/ui/todo/todo-bar"
import { CanvasPanel } from "@/ui/canvas/canvas-panel"
import { useCanvasResize } from "@/ui/canvas/use-canvas-resize"

import { browserEngine, browserListClient } from "./page-clients"
import { ShellOverlays } from "./shell-overlays"
import { useAwaitingNotify } from "./use-awaiting-notify"
import { useCanvasWorkspace } from "./use-canvas-workspace"
import { useComposerSelectors } from "./use-composer-selectors"
import { useConversationList } from "./use-conversation-list"
import { useDraft } from "./use-draft"
import { ScenarioCards } from "./scenario-cards"
import { useOverlayPanels } from "./use-overlay-panels"
import { removePinned, usePinnedSkills } from "./use-pinned-skills"

import styles from "./session-shell.module.css"

// 新对话快捷键 ⇧⌘O（mac）/ ⇧Ctrl O（其它平台）：与侧栏展示的提示一致。
function isNewChatShortcut(event: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}): boolean {
  return (event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "o"
}

type SessionShellProps = {
  // 测试注入缝：不传则使用页面级单例引擎。
  engine?: SessionEngine | null
  // 服务端按 host 解析的站点品牌名（SITE-REAL），透传给 rail。
  brandName?: string
}

export function SessionShell({ engine: injectedEngine, brandName }: SessionShellProps = {}) {
  const t = useT()
  const engine = injectedEngine !== undefined ? injectedEngine : browserEngine()
  const snapshot = useSessionEngine(engine)
  const { machine, notice, store, thread, pendingMode, staging } = snapshot

  // 水合后才渲染主内容：rail 与 composer 立即就位，会话线随后淡入。
  const mounted = useHydrated()

  const [railCollapsed, setRailCollapsed] = useState(false)
  // 移动端 rail 抽屉开合（WEB-MOBILE，仅 ≤768px 生效）：汉堡开、选中/背幕/新对话即关。
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  // 域 controller：固定技能 / composer 选择器 / 浮层面板开合（自持状态与副作用）。
  const pinnedSkills = usePinnedSkills(engine)
  const selectors = useComposerSelectors(engine)
  const panels = useOverlayPanels()

  // 侧栏可拖拽改宽（两侧自由，均有最小宽度）；收起态用固定窄列，不参与拖拽。
  const { width: railWidth, isResizing, shellRef, onResizeStart } = useRailResize()
  // canvas 第三栏拖拽改宽：与 rail 共用 shell 容器几何。
  const {
    width: canvasWidth,
    isResizing: isCanvasResizing,
    onResizeStart: onCanvasResizeStart,
  } = useCanvasResize(shellRef)

  const isStreaming = machine.phase !== "idle" && machine.phase !== "error"
  const isReconnecting = machine.phase === "reattaching"
  const hasMessages = thread.messages.length > 0
  // 失败双源：client/机器错误态（machine.error）与 agent 裁决的 run.failed 终态，都显式呈现。
  const hasFailed = !isStreaming && (machine.phase === "error" || thread.runStatus === "failed")
  // 402：run 被 credit_insufficient 拒——错误码由 client 从错误体取出，落在 machine.error。据此给计费
  // 专用说明 + 价格/联系入口（不复用通用失败文案）。
  const creditRejected = hasFailed && isCreditInsufficient(machine.error)

  const mode = store ? activeMode(store) : pendingMode
  // 已开聊即锁定：线程有消息（本地追加或 snapshot 水合）后模式不可再切换。
  const modeLocked = thread.messages.length > 0
  const activeId = store?.activeId ?? null

  const focusComposer = useCallback(() => {
    const node = composerRef.current
    if (node) {
      node.style.height = "auto"
      node.focus()
    }
  }, [])

  // 未发送草稿（按会话持久化）与会话清单/待批/canvas 各自的 controller。
  const { draft, updateDraft, clearDraft } = useDraft(activeId, mounted)
  const conversationsCtl = useConversationList({ engine, activeId, thread, isStreaming, focusComposer })
  const awaitingIds = useAwaitingNotify(activeId, machine.phase, t)
  const canvas = useCanvasWorkspace(activeId, thread, mounted)

  const presentation = modePresentation(t, mode, hasFailed ? "failed" : machine.phase, hasMessages)

  const submitDraft = useCallback(() => {
    const content = draft.trim()
    if (!engine || !content || content.length > MAX_INPUT_LENGTH) {
      return
    }
    // 流式中提交=运行中插话（engine 识别活跃相位走 steer，不打断本轮）。
    engine.submit(content)
    clearDraft()
    focusComposer()
  }, [draft, clearDraft, engine, focusComposer])

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

  // 新对话快捷键 ⇧⌘O（侧栏展示该提示，故全局接入键盘使其真实可用）。
  const startNewChat = conversationsCtl.startNewChat
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
  const { threadEndRef, isNearBottom, scrollToLatest, handleThreadScroll } = useAutoScroll(thread, isStreaming)

  // 上滑阅读历史时若有新内容到来，浮出「回到最新」入口；贴底跟随时不出现。
  const showJumpToLatest = hasMessages && !isNearBottom
  const canSend = draft.trim().length > 0
  const conversations = conversationsCtl.conversations

  return (
    <main
      ref={shellRef}
      className={styles.shell}
      data-rail-collapsed={railCollapsed ? "true" : "false"}
      data-canvas-open={canvas.canvasOpen ? "true" : undefined}
      data-mobile-nav-open={mobileNavOpen ? "true" : undefined}
      data-resizing={isResizing || isCanvasResizing ? "true" : undefined}
      style={
        {
          "--kk-rail-width": `${railWidth}px`,
          "--kk-canvas-width": `${canvasWidth}px`,
        } as CSSProperties
      }
    >
      {/* 移动端汉堡：仅 ≤768px 显示，开启 rail 抽屉（桌面态由 CSS 隐藏）。 */}
      <button
        type="button"
        className={styles.mobileNavToggle}
        aria-label={t("shell.openNav")}
        onClick={() => setMobileNavOpen(true)}
      >
        <span aria-hidden>☰</span>
      </button>
      {/* 抽屉背幕：仅移动端且抽屉开启时铺满，点击即关。 */}
      {mobileNavOpen ? (
        <div
          className={styles.mobileNavBackdrop}
          role="presentation"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <SessionRail
        collapsed={railCollapsed}
        mobileOpen={mobileNavOpen}
        onToggleCollapse={() => setRailCollapsed((value) => !value)}
        onNewChat={() => {
          startNewChat()
          setMobileNavOpen(false)
        }}
        brandName={brandName}
        conversations={conversations}
        activeId={activeId}
        awaitingIds={awaitingIds}
        onSelectConversation={(id) => {
          conversationsCtl.selectConversation(id)
          setMobileNavOpen(false)
        }}
        onDeleteConversation={conversationsCtl.deleteConversation}
        onRenameConversation={conversationsCtl.renameConversation}
        onOpenSkills={panels.openSkills}
        onOpenMcp={panels.openMcp}
        onOpenBilling={panels.openBilling}
        onOpenTeams={panels.openTeams}
        onOpenLibrary={panels.openLibrary}
        onOpenSettings={panels.openSettings}
        listLoading={conversationsCtl.loading}
        listError={conversationsCtl.error}
        hasMore={conversationsCtl.hasMore}
        onLoadMore={conversationsCtl.loadMore}
      />

      {/* 拖拽分隔条：调整 rail/main 宽度（两侧自由、各有最小宽度）；收起态不可拖。 */}
      {!railCollapsed ? (
        <div
          className={styles.resizer}
          role="separator"
          aria-orientation="vertical"
          aria-label={t("shell.resizeAria")}
          onPointerDown={onResizeStart}
        />
      ) : null}

      <section className={styles.main}>
        {/* 会话头部（SHARE-1）：有活跃会话且已开聊时显分享入口——创建可撤销只读链接。 */}
        {mounted && activeId !== null && hasMessages ? (
          <div className={styles.mainHeader}>
            {/* 会话头部标题可改（CONV-UX）：与侧栏条目同一 renameConversation 收口。 */}
            <HeaderTitle
              title={conversations.find((c) => c.id === activeId)?.title ?? conversationTitle(thread.messages)}
              onRename={(title) => conversationsCtl.renameConversation(activeId, title)}
            />
            <ShareButton client={browserListClient()} sessionId={activeId} />
          </div>
        ) : null}
        {!mounted ? (
          <div className={styles.stage} aria-hidden />
        ) : hasMessages ? (
          <ConversationThread
            sessionId={activeId}
            thread={thread}
            isStreaming={isStreaming}
            isReconnecting={isReconnecting}
            hasFailed={hasFailed}
            creditRejected={creditRejected}
            onOpenBilling={panels.openBilling}
            onOpenPricing={panels.openPricing}
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
            onOpenFile={canvas.openFile}
            onOpenDelivery={canvas.openDelivery}
            onOpenTool={canvas.openTool}
          />
        ) : (
          <div className={styles.hero}>
            <h1 className={styles.headline}>{t("shell.heading")}</h1>
            <p className={styles.subhead}>{t("shell.subhead")}</p>
            <ScenarioCards
              onPick={(prompt) => {
                updateDraft(prompt)
                focusComposer()
              }}
            />
          </div>
        )}

        {showJumpToLatest ? (
          <button className={styles.jump} type="button" onClick={scrollToLatest}>
            <span aria-hidden>↓</span>
            <span>{t("shell.backToLatest")}</span>
          </button>
        ) : null}

        {/* 计划条钉在输入框正上方，可收缩；思考/工具/子智能体在 ConversationThread 内联呈现。 */}
        {mounted ? <TodoBar todos={thread.todos} /> : null}

        <Composer
          draft={draft}
          onDraftChange={updateDraft}
          onKeyDown={handleKeyDown}
          onSubmit={handleSubmit}
          isStreaming={isStreaming}
          canSend={canSend}
          onStop={() => engine?.cancelRun()}
          transportLabel={notice ? t(notice.key, notice.vars) : presentation.transportLabel}
          modeHint={presentation.modeHint}
          composerRef={composerRef}
          mode={mode}
          onModeChange={(next) => engine?.setMode(next)}
          modeLocked={modeLocked}
          pinnedSkills={pinnedSkills}
          onUnpinSkill={removePinned}
          models={selectors.models}
          selectedModel={selectors.selectedModel}
          onModelChange={selectors.setSelectedModel}
          modelLocked={modeLocked}
          agents={selectors.agents}
          selectedAgent={selectors.selectedAgent}
          onAgentChange={selectors.setSelectedAgent}
          agentLocked={modeLocked}
        />

        {/* 重开入口：槽里还有内容但被手动关过——一键回到上次看的产物。 */}
        {canvas.canReopenCanvas ? (
          <button type="button" className={styles.canvasReopen} onClick={canvas.onReopen}>
            {t("canvas.reopen")}
          </button>
        ) : null}
      </section>

      {canvas.resolvedCanvas !== null && activeId !== null ? (
        <>
          {/* 拖拽分隔条：调整 main/canvas 宽度；全屏态无列可拖。 */}
          {!canvas.fullscreen ? (
            <div
              className={styles.canvasResizer}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("canvas.resizeAria")}
              onPointerDown={onCanvasResizeStart}
            />
          ) : null}
          <CanvasPanel
            sessionId={activeId}
            content={canvas.resolvedCanvas}
            files={thread.files}
            deliveries={thread.deliveries}
            fullscreen={canvas.fullscreen}
            onSelectFile={canvas.onSelectFile}
            onSelectDelivery={canvas.onSelectDelivery}
            onToggleFullscreen={canvas.onToggleFullscreen}
            onClose={canvas.onClose}
          />
        </>
      ) : null}

      <ShellOverlays
        panels={panels}
        pinnedSkills={pinnedSkills}
        onOpenSession={conversationsCtl.selectConversation}
        brandName={brandName}
      />
    </main>
  )
}
