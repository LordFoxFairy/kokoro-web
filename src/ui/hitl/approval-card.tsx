import type { SessionToolCall } from "@/core/state"
import type { ToolDecision } from "@/engine/hitl-staging"
import { useT } from "@/i18n/context"

import styles from "../thread/thread.module.css"

type ApprovalCardProps = {
  tool: SessionToolCall
  // 该工具已暂存的决策（引擎 staging 快照）；同帧未凑齐时先「已记录」。
  staged?: ToolDecision
  // 本轮仍处 awaiting-hitl 相位才允许发决策；resume 已发出后按钮收口。
  hitlActive: boolean
  // control POST 失败：呈现错误并放开按钮允许重试（暂存仍在，重按即重发）。
  controlError: string | null
  onDecision?: (toolId: string, decision: ToolDecision) => void
}

// 工具审批卡（kind=tool_approval）：按钮严格来自契约 allowed_decisions ∩ {approve,edit,reject}，
// respond 永不在审批卡出现（只属于 ask_user 问答卡与 result_review 审核卡）。
// edit：法源要求 editable=true 且该工具有安全定制编辑 UI 才展示；V1 无任何定制编辑器、
// 亦禁止通用 JSON textarea，故编辑入口一律不出现（args 由工具行只读展示）。
export function ApprovalCard({
  tool,
  staged,
  hitlActive,
  controlError,
  onDecision,
}: ApprovalCardProps) {
  const t = useT()
  const decided = staged !== undefined
  const actionable = hitlActive && onDecision !== undefined
  // 已暂存且未报错即禁用（防连点双发）；POST 失败时放开允许重试。
  const disabled = !actionable || (decided && controlError === null)
  const allowedDecisions = tool.allowedDecisions ?? []
  const canApprove = allowedDecisions.includes("approve")
  const canReject = allowedDecisions.includes("reject")
  // description=工具自述（agent 装配侧注入的真实数据；查不到发空串）——有则显示，缺省中文兜底。
  const prompt = tool.description || t("hitl.approvalHint")
  const promptText = controlError
    ? t("hitl.decisionFailed")
    : decided || !hitlActive
      ? t("hitl.decisionRecorded")
      : prompt

  return (
    <div className={styles.toolApproval} role="group" aria-label={t("hitl.approvalTitle")}>
      <p className={styles.toolApprovalPrompt}>{promptText}</p>
      {tool.risk !== undefined ? (
        <p className={styles.toolRisk} data-level={tool.risk.level}>
          {t("hitl.riskLine", {
            level: tool.risk.level,
            source: tool.risk.source,
            reason: tool.risk.reason,
          })}
        </p>
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
              {t("hitl.approve")}
            </button>
          ) : null}
          {canReject ? (
            <button
              type="button"
              className={styles.toolReject}
              disabled={disabled}
              onClick={() => onDecision(tool.id, { type: "reject" })}
            >
              {t("hitl.reject")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
