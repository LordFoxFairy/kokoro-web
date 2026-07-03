import { useState } from "react"

import type { SessionToolCall } from "@/core/state"
import type { ToolDecision } from "@/engine/hitl-staging"

import styles from "../thread/thread.module.css"

type ReviewCardProps = {
  tool: SessionToolCall
  // 该工具已暂存的决策（引擎 staging 快照）；同帧未凑齐时先「已记录」。
  staged?: ToolDecision
  // 本轮仍处 awaiting-hitl 相位才允许发决策；resume 已发出后按钮收口。
  hitlActive: boolean
  // control POST 失败：呈现错误并放开按钮允许重试（暂存仍在，重按即重发）。
  controlError: string | null
  onDecision?: (toolId: string, decision: ToolDecision) => void
}

// 结果审核卡（kind=result_review）：工具已执行、结果回流模型前停下——
// 采纳（approve=原结果）/ 替换（respond{response}=人工替换文本，空文本禁用）/ 拒绝（reject=废弃）。
export function ReviewCard({
  tool,
  staged,
  hitlActive,
  controlError,
  onDecision,
}: ReviewCardProps) {
  const [replacement, setReplacement] = useState("")
  const decided = staged !== undefined
  const actionable = hitlActive && onDecision !== undefined
  // 已暂存且未报错即禁用（防连点双发）；POST 失败时放开允许重试。
  const disabled = !actionable || (decided && controlError === null)
  const allowedDecisions = tool.allowedDecisions ?? []
  const canApprove = allowedDecisions.includes("approve")
  const canRespond = allowedDecisions.includes("respond")
  const canReject = allowedDecisions.includes("reject")
  const replacementText = replacement.trim()
  const prompt = tool.description || "工具已执行，结果需要你的审核。"
  const promptText = controlError
    ? "决定发送失败，请重试。"
    : decided || !hitlActive
      ? "已记录你的决定…"
      : prompt

  return (
    <div className={styles.toolApproval} role="group" aria-label="工具结果待审核">
      <p className={styles.toolApprovalPrompt}>{promptText}</p>
      {/* 待审结果只读区：与 returned 结果同一视觉语言（人审的就是它）。 */}
      <pre className={styles.toolResult}>{tool.result ?? ""}</pre>
      {canRespond ? (
        <div className={styles.toolRespond}>
          <input
            className={styles.toolRespondInput}
            aria-label="替换结果"
            value={replacement}
            disabled={disabled}
            onChange={(event) => setReplacement(event.target.value)}
          />
          <button
            type="button"
            className={styles.toolRespondSend}
            disabled={disabled || replacementText.length === 0}
            onClick={() => onDecision?.(tool.id, { type: "respond", message: replacementText })}
          >
            替换
          </button>
        </div>
      ) : null}
      {actionable && (canApprove || canReject) ? (
        <div className={styles.toolApprovalActions}>
          {canApprove ? (
            <button
              type="button"
              className={styles.toolApprove}
              disabled={disabled}
              onClick={() => onDecision(tool.id, { type: "approve" })}
            >
              采纳
            </button>
          ) : null}
          {canReject ? (
            <button
              type="button"
              className={styles.toolReject}
              disabled={disabled}
              onClick={() => onDecision(tool.id, { type: "reject" })}
            >
              拒绝
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
