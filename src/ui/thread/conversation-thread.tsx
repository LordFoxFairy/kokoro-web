import type { RefObject, UIEvent } from "react"

import type { AgentMode } from "@/core/conversations"
import { buildThreadItems } from "@/core/projections"
import type { SessionStreamState } from "@/core/state"
import type { ToolDecision } from "@/engine/hitl-staging"

import { AssistantTurn } from "./assistant-turn"
import { MessageBubble } from "./message-bubble"
import styles from "./thread.module.css"

const NO_DECISIONS: Record<string, ToolDecision> = {}

type ConversationThreadProps = {
  onOpenFile?: (path: string) => void
  // 产物端点 URL 构造需要（透传到工具行的产物卡）。
  sessionId: string | null
  thread: SessionStreamState
  isStreaming: boolean
  // 重连续传态：在途轮的 live 锚点改为「重连中…」，区别于普通「正在思考…」。
  isReconnecting: boolean
  hasFailed: boolean
  onRetry: () => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  threadEndRef: RefObject<HTMLDivElement | null>
  // 本会话模式：透传给每轮过程块，驱动 Fast/Thinking 的密度与文案差异。
  mode: AgentMode
  // HITL：引擎快照的决策暂存视图（runId → toolId → decision）与本轮 awaiting 相位信息。
  stagingByRun: Record<string, Record<string, ToolDecision>>
  hitlRunId: string | null
  controlError: string | null
  onToolDecision?: (runId: string, toolId: string, decision: ToolDecision) => void
  // ask_user 问答卡的取消 run 入口（透传到工具行）。
  onCancelRun?: () => void
}

export function ConversationThread({
  sessionId,
  onOpenFile,
  thread,
  isStreaming,
  isReconnecting,
  hasFailed,
  onRetry,
  onScroll,
  threadEndRef,
  mode,
  stagingByRun,
  hitlRunId,
  controlError,
  onToolDecision,
  onCancelRun,
}: ConversationThreadProps) {
  // 把扁平 messages + 有序 steps 折成线程项：用户气泡 / assistant 轮（一个 runId 一轮）。
  const items = buildThreadItems(thread)
  // 流式中：最后一个 assistant 轮是当前在途的那一轮——唯一带「实时」语义的 turn。
  let liveRunId: string | undefined
  if (isStreaming) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i]
      if (item?.kind === "assistant-turn") {
        liveRunId = item.runId
        break
      }
    }
  }

  // 提交后、首个 step/token 未到：在途轮还没产生任何可渲染项（最后一项仍是用户胶囊）。
  // 合成一个无内容的 live 脚手架轮，让 AssistantTurn 渲染「就近 live 成形线」，
  // 绝不在提交与首 token 之间留空帧。一旦首个 step/text 到达，buildThreadItems 即接管，脚手架退场。
  const showScaffoldTurn = isStreaming && items[items.length - 1]?.kind !== "assistant-turn"

  return (
    <div
      className={styles.thread}
      role="log"
      aria-label="对话记录"
      aria-live="polite"
      onScroll={onScroll}
    >
      <div className={styles.inner}>
        {items.map((item) =>
          item.kind === "user" ? (
            <MessageBubble key={item.message.id} message={item.message} />
          ) : (
            <AssistantTurn
              sessionId={sessionId}
              onOpenFile={onOpenFile}
              key={item.runId}
              steps={item.steps}
              messagesById={item.messagesById}
              isLive={item.runId === liveRunId}
              reconnecting={item.runId === liveRunId && isReconnecting}
              mode={mode}
              stagedDecisions={stagingByRun[item.runId] ?? NO_DECISIONS}
              hitlActive={item.runId === hitlRunId}
              controlError={item.runId === hitlRunId ? controlError : null}
              onToolDecision={
                onToolDecision
                  ? (toolId, decision) => onToolDecision(item.runId, toolId, decision)
                  : undefined
              }
              onCancelRun={item.runId === hitlRunId ? onCancelRun : undefined}
            />
          ),
        )}

        {showScaffoldTurn ? (
          <AssistantTurn
            sessionId={sessionId}
            steps={[]}
            messagesById={{}}
            isLive
            reconnecting={isReconnecting}
            mode={mode}
            stagedDecisions={NO_DECISIONS}
            hitlActive={false}
            controlError={null}
          />
        ) : null}

        {hasFailed ? (
          <div className={styles.error} role="alert">
            <span>这一轮没能完成，稍后再试一次。</span>
            <button className={styles.retry} type="button" onClick={onRetry}>
              重试
            </button>
          </div>
        ) : null}

        <div ref={threadEndRef} />
      </div>
    </div>
  )
}
