import type { RefObject, UIEvent } from "react"

import type { AgentMode } from "@/core/conversations"
import { buildThreadItems } from "@/core/projections"
import type { SessionDelivery, SessionStreamState, SessionToolCall } from "@/core/state"
import type { ToolDecision } from "@/engine/hitl-staging"
import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"

import { AssistantTurn } from "./assistant-turn"
import { DeliverySection } from "./delivery-card"
import { MessageBubble } from "./message-bubble"
import styles from "./thread.module.css"

const NO_DECISIONS: Record<string, ToolDecision> = {}

type ConversationThreadProps = {
  onOpenFile?: (path: string) => void
  // 成果卡点击 → canvas 打开冻结预览；工具 pill 点击 → canvas 打开参数/结果详情。
  onOpenDelivery?: (delivery: SessionDelivery) => void
  onOpenTool?: (runId: string, tool: SessionToolCall) => void
  // 产物端点 URL 构造需要（透传到工具行的产物卡）。
  sessionId: string | null
  thread: SessionStreamState
  isStreaming: boolean
  // 重连续传态：在途轮的 live 锚点改为「重连中…」，区别于普通「正在思考…」。
  isReconnecting: boolean
  hasFailed: boolean
  // 402：run 被 credit_insufficient 拒——失败处改给计费专用说明 + 查看余额入口（不用通用失败文案）。
  creditRejected: boolean
  onOpenBilling: () => void
  // PAY-2：402 说明处的「查看套餐」入口——闭环 Wave3 留的价格入口，打开购买面板。
  onOpenPricing: () => void
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

// 失败讲人话：契约失败码 → 文案 key。闭集 7 码逐码本地化，未知码兜底通用句。i18n 在渲染处按码取译。
export function failureCopyKey(runError: { code: string; message: string } | null): MessageKey {
  switch (runError?.code) {
    case "token_budget_exceeded":
      return "fail.tokenBudget"
    case "recursion_limit_exceeded":
      return "fail.recursion"
    case "assembly_failed":
      return "fail.assembly"
    case "enqueue_failed":
      return "fail.enqueue"
    case "dispatch_exhausted":
      return "fail.dispatch"
    case "contract_incompatible":
      return "fail.contract"
    case "internal_error":
      return "fail.internal"
    default:
      return "fail.generic"
  }
}

export function ConversationThread({
  sessionId,
  onOpenFile,
  onOpenDelivery,
  onOpenTool,
  thread,
  isStreaming,
  isReconnecting,
  hasFailed,
  creditRejected,
  onOpenBilling,
  onOpenPricing,
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
  const t = useT()
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
      aria-label={t("thread.recordAria")}
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
              onOpenTool={
                onOpenTool ? (tool) => onOpenTool(item.runId, tool) : undefined
              }
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

        {/* 成果区：会话流尾部聚合本会话全部成果（终态一目了然，不用翻消息流）。 */}
        {onOpenDelivery ? (
          <DeliverySection
            sessionId={sessionId}
            deliveries={thread.deliveries}
            onOpen={onOpenDelivery}
          />
        ) : null}

        {hasFailed && creditRejected ? (
          <div className={styles.error} role="alert">
            <span>{t("billing.creditRejected")}</span>
            <span>{t("billing.creditPricing")}</span>
            <button className={styles.retry} type="button" onClick={onOpenPricing}>
              {t("billing.viewPricing")}
            </button>
            <button className={styles.retry} type="button" onClick={onOpenBilling}>
              {t("billing.viewBalance")}
            </button>
            <button className={styles.retry} type="button" onClick={onRetry}>
              {t("thread.retry")}
            </button>
          </div>
        ) : hasFailed ? (
          <div className={styles.error} role="alert">
            <div className={styles.errorBody}>
              <span>{t(failureCopyKey(thread.runError))}</span>
              {/* internal_error 额外反馈指引：重试仍失败时引导用户把详情反馈给我们。 */}
              {thread.runError?.code === "internal_error" ? (
                <span className={styles.errorHint}>{t("fail.internalHint")}</span>
              ) : null}
              {/* message 原文折叠可展开（兜底展示，绝不裸露错误码）。 */}
              {thread.runError?.message ? (
                <details className={styles.errorDetail}>
                  <summary>{t("fail.showDetail")}</summary>
                  <pre>{thread.runError.message}</pre>
                </details>
              ) : null}
            </div>
            <button className={styles.retry} type="button" onClick={onRetry}>
              {t("thread.retry")}
            </button>
          </div>
        ) : null}

        <div ref={threadEndRef} />
      </div>
    </div>
  )
}
