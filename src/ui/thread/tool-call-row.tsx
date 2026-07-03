import type { SessionToolCall, ToolStatus } from "@/core/state"
import type { ToolDecision } from "@/engine/hitl-staging"
import { ApprovalCard } from "@/ui/hitl/approval-card"
import { AskUserCard } from "@/ui/hitl/ask-user-card"
import { ReviewCard } from "@/ui/hitl/review-card"
import { ChevronIcon, WrenchIcon } from "@/ui/icons/thread"

import { RunState } from "./run-state"
import styles from "./thread.module.css"

// 工具参数压成紧凑 JSON 预览；空参数返回 null（不渲染参数块）。
function formatArgs(args: Record<string, unknown>): string | null {
  const keys = Object.keys(args)
  if (keys.length === 0) {
    return null
  }
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    // 出现循环引用等无法序列化的值时降级为键名列表，绝不因日志化参数而抛错。
    return keys.join(", ")
  }
}

// 结构化收口状态 → 人话：文案只活在渲染层，状态层零 UI 文案。
const CLOSED_NOTE: Partial<Record<ToolStatus, string>> = {
  "stale-awaiting": "运行已结束，该工具未获批准、未执行。",
  "stale-running": "运行已结束，该工具没有返回结果。",
  cancelled: "已停止，该工具没有返回结果。",
}

// 单条工具调用：扳手 + 名称 + 运行态。有入参/结果/错误/待批时是可展开的 <details>，
// 无任何细节时退化为不可点击的 <div>，避免无意义的死切换。
// awaiting 时按契约 kind 分流三张 HITL 卡：tool_approval → 审批卡；ask_user → 问答卡；
// result_review → 结果审核卡。
export function ToolCallRow({
  tool,
  staged,
  hitlActive,
  controlError,
  onDecision,
  onCancelRun,
}: {
  tool: SessionToolCall
  // 该工具已暂存的决策（引擎 staging 快照）；同帧未凑齐时先「已记录」。
  staged?: ToolDecision
  // 本轮仍处 awaiting-hitl 相位才允许发决策；resume 已发出后按钮收口。
  hitlActive: boolean
  // control POST 失败：呈现错误并放开按钮允许重试（暂存仍在，重按即重发）。
  controlError: string | null
  onDecision?: (toolId: string, decision: ToolDecision) => void
  // 问答卡（ask_user）自带的取消 run 入口。
  onCancelRun?: () => void
}) {
  const argsText = formatArgs(tool.args)
  const running = tool.status === "running"
  const failed = tool.status === "error"
  // awaiting：被门控工具等待用户批准/回答（HITL），展开显示对应卡片。
  const awaiting = tool.status === "awaiting"
  // rejected：用户驳回了该调用——工具未执行，显禁止圈而非绿勾。
  const rejected = tool.status === "rejected"
  const closedNote = CLOSED_NOTE[tool.status]
  // responded：done 态但结果由人工答复（非工具产出）——加 provenance 标记，让回看者一眼可辨。
  const responded = Boolean(tool.responded)
  // 有入参/结果/错误/待批/已拒绝/收口说明才展开；无任何细节的工具保持紧凑静态行。
  const hasDetail =
    argsText !== null ||
    Boolean(tool.result) ||
    failed ||
    awaiting ||
    rejected ||
    closedNote !== undefined

  const head = (
    <>
      <WrenchIcon className={styles.toolIcon} />
      <span className={styles.toolName}>{tool.name}</span>
      {responded ? <span className={styles.toolResponded}>已人工答复</span> : null}
      <span className={styles.toolState} aria-hidden>
        <RunState
          done={tool.status === "done"}
          failed={failed}
          awaiting={awaiting}
          rejected={rejected || closedNote !== undefined}
        />
      </span>
    </>
  )

  if (!hasDetail) {
    return (
      <div className={styles.tool} data-status={tool.status}>
        <div className={`${styles.toolSummary} ${styles.toolSummaryStatic}`}>{head}</div>
      </div>
    )
  }

  return (
    <details
      className={styles.tool}
      data-status={tool.status}
      open={running || failed || awaiting || rejected}
    >
      {/* chevron 作为统一的「可展开」提示——只有可展开行才有，静态行没有，让两者一眼可辨。 */}
      <summary className={styles.toolSummary}>
        {head}
        <ChevronIcon className={styles.toolChevron} />
      </summary>
      <div className={styles.toolDetail}>
        {/* V1 args 只读展示（无定制编辑 UI 前不提供任何参数编辑入口）。 */}
        {argsText !== null ? <pre className={styles.toolArgs}>{argsText}</pre> : null}
        {awaiting ? (
          tool.awaitingKind === "ask_user" ? (
            <AskUserCard
              tool={tool}
              staged={staged}
              hitlActive={hitlActive}
              controlError={controlError}
              onDecision={onDecision}
              onCancelRun={onCancelRun}
            />
          ) : tool.awaitingKind === "result_review" ? (
            <ReviewCard
              tool={tool}
              staged={staged}
              hitlActive={hitlActive}
              controlError={controlError}
              onDecision={onDecision}
            />
          ) : (
            <ApprovalCard
              tool={tool}
              staged={staged}
              hitlActive={hitlActive}
              controlError={controlError}
              onDecision={onDecision}
            />
          )
        ) : null}
        {failed ? (
          <p className={styles.toolError} role="status">
            {/* || 而非 ??：空串错误文本（无消息异常）也回落到兜底文案，绝不渲染空白红条。 */}
            {tool.errorText || "工具调用失败"}
          </p>
        ) : rejected ? (
          <p className={styles.toolRejectedNote} role="status">
            你已拒绝该工具调用，未执行。
          </p>
        ) : closedNote !== undefined ? (
          <p className={styles.toolRejectedNote} role="status">
            {closedNote}
          </p>
        ) : tool.result && !awaiting ? (
          // awaiting 时不重复渲染结果：result_review 的待审结果由审核卡只读区独占展示。
          <pre className={styles.toolResult}>{tool.result}</pre>
        ) : running ? (
          <p className={styles.pending}>
            运行中
            <span className={styles.pulse} aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </p>
        ) : null}
      </div>
    </details>
  )
}
