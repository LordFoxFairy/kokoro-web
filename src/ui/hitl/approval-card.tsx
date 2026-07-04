import type { SessionToolCall } from "@/core/state"
import type { ToolDecision } from "@/engine/hitl-staging"

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
  const decided = staged !== undefined
  const actionable = hitlActive && onDecision !== undefined
  // 已暂存且未报错即禁用（防连点双发）；POST 失败时放开允许重试。
  const disabled = !actionable || (decided && controlError === null)
  const allowedDecisions = tool.allowedDecisions ?? []
  const canApprove = allowedDecisions.includes("approve")
  const canReject = allowedDecisions.includes("reject")
  // wire description 是执行侧英文模板（调试语料）：不作展示文案，参数块已完整呈现审批对象。
  const prompt = "该工具调用需要你的批准，请确认参数。"
  const promptText = controlError
    ? "决定发送失败，请重试。"
    : decided || !hitlActive
      ? "已记录你的决定…"
      : prompt

  return (
    <div className={styles.toolApproval} role="group" aria-label="工具调用待批准">
      <p className={styles.toolApprovalPrompt}>{promptText}</p>
      {tool.risk !== undefined ? (
        <p className={styles.toolRisk} data-level={tool.risk.level}>
          风险 {tool.risk.level} · {tool.risk.source}：{tool.risk.reason}
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
              批准
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
