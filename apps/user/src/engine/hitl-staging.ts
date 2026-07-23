// HITL 决策暂存纯逻辑：以契约 pending_tool_ids 为完备判据（不内嵌 agent 算法知识）。

import type { ResumeDecision } from "@/contract/control"
import type { SessionStep } from "@/core/state"

// UI 侧决策输入（edit 暂无 UI 入口，契约层保留）。
// submit：kind=input 动态表单的结构化提交（契约 SubmitDecision，request_id=发起工具 tool_id）。
export type ToolDecision =
  | { type: "approve" }
  | { type: "reject" }
  | { type: "respond"; message: string }
  | { type: "submit"; value: Record<string, unknown> }

export type StagedDecisions = ReadonlyMap<string, ToolDecision>

// 当前 awaiting 帧的完整待批集合：直接读契约字段（同帧每个 awaiting 工具都携带同一份）。
export function pendingToolIdsOf(steps: readonly SessionStep[]): readonly string[] {
  for (const step of steps) {
    if (step.kind === "tool" && step.tool.status === "awaiting" && step.tool.pendingToolIds) {
      return step.tool.pendingToolIds
    }
  }
  return []
}

export function stageDecision(
  staged: StagedDecisions,
  toolId: string,
  decision: ToolDecision,
): StagedDecisions {
  const next = new Map(staged)
  next.set(toolId, decision)
  return next
}

// 凑齐同帧全部待批工具才产出决策数组（按 pending_tool_ids 顺序）；未凑齐返回 null。
export function buildResumeDecisions(
  staged: StagedDecisions,
  pendingToolIds: readonly string[],
): ResumeDecision[] | null {
  if (pendingToolIds.length === 0) {
    return null
  }
  const decisions: ResumeDecision[] = []
  for (const toolId of pendingToolIds) {
    const decision = staged.get(toolId)
    if (!decision) {
      return null
    }
    if (decision.type === "approve") {
      decisions.push({ type: "approve", tool_id: toolId })
    } else if (decision.type === "reject") {
      decisions.push({ type: "reject", tool_id: toolId })
    } else if (decision.type === "respond") {
      decisions.push({ type: "respond", tool_id: toolId, response: decision.message })
    } else {
      // 契约 SubmitDecision：锚字段是 request_id（同一暂停帧内即发起工具的 tool_id）。
      decisions.push({ type: "submit", request_id: toolId, value: decision.value })
    }
  }
  return decisions
}

// 部分拒绝：提交成功后本地只把被拒工具置 rejected，批准的不动。
export function rejectedToolIds(
  staged: StagedDecisions,
  pendingToolIds: readonly string[],
): string[] {
  return pendingToolIds.filter((toolId) => staged.get(toolId)?.type === "reject")
}
