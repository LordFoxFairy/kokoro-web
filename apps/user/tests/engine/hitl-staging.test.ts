import { describe, expect, it } from "vitest"

import {
  buildResumeDecisions,
  pendingToolIdsOf,
  rejectedToolIds,
  stageDecision,
  type StagedDecisions,
  type ToolDecision,
} from "@/engine/hitl-staging"
import type { SessionStep } from "@/core/state"

function awaitingStep(toolId: string, pendingToolIds: string[]): SessionStep {
  return {
    kind: "tool",
    seq: 1,
    segmentId: "seg_1",
    tool: { id: toolId, name: "w", args: {}, status: "awaiting", pendingToolIds },
  }
}

function staged(entries: [string, ToolDecision][]): StagedDecisions {
  return new Map(entries)
}

describe("pendingToolIdsOf：契约字段为唯一凑帧判据", () => {
  it("从 awaiting 工具读取契约 pending_tool_ids", () => {
    const steps = [awaitingStep("tool_1", ["tool_1", "tool_2"])]
    expect(pendingToolIdsOf(steps)).toEqual(["tool_1", "tool_2"])
  })

  it.each<[string, SessionStep[]]>([
    ["无步骤", []],
    ["无 awaiting 工具", [
      {
        kind: "tool",
        seq: 1,
        segmentId: "seg_1",
        tool: { id: "tool_1", name: "w", args: {}, status: "done" },
      },
    ]],
    ["awaiting 但缺契约字段（旧落盘）", [
      {
        kind: "tool",
        seq: 1,
        segmentId: "seg_1",
        tool: { id: "tool_1", name: "w", args: {}, status: "awaiting" },
      },
    ]],
  ])("%s → 空集合", (_label, steps) => {
    expect(pendingToolIdsOf(steps)).toEqual([])
  })
})

describe("buildResumeDecisions：凑齐才提交", () => {
  it("部分决策未凑齐返回 null", () => {
    const decisions = buildResumeDecisions(
      staged([["tool_1", { type: "approve" }]]),
      ["tool_1", "tool_2"],
    )
    expect(decisions).toBeNull()
  })

  it("空待批集合永不提交", () => {
    expect(buildResumeDecisions(staged([["tool_1", { type: "approve" }]]), [])).toBeNull()
  })

  it("凑齐后按 pending_tool_ids 顺序产出契约决策（部分拒绝）", () => {
    const frame = staged([
      ["tool_2", { type: "reject" }],
      ["tool_1", { type: "approve" }],
      ["tool_3", { type: "respond", message: "use option b" }],
    ])
    const decisions = buildResumeDecisions(frame, ["tool_1", "tool_2", "tool_3"])
    expect(decisions).toEqual([
      { type: "approve", tool_id: "tool_1" },
      { type: "reject", tool_id: "tool_2" },
      { type: "respond", tool_id: "tool_3", response: "use option b" },
    ])
    expect(rejectedToolIds(frame, ["tool_1", "tool_2", "tool_3"])).toEqual(["tool_2"])
  })

  it("submit 决策映射为契约 SubmitDecision（锚字段 request_id=tool_id）", () => {
    const frame = staged([["tool_1", { type: "submit", value: { otp: "123456" } }]])
    expect(buildResumeDecisions(frame, ["tool_1"])).toEqual([
      { type: "submit", request_id: "tool_1", value: { otp: "123456" } },
    ])
    expect(rejectedToolIds(frame, ["tool_1"])).toEqual([])
  })

  it("stageDecision 不可变：改写决策产生新 Map 且可覆盖", () => {
    const first = stageDecision(new Map(), "tool_1", { type: "approve" })
    const second = stageDecision(first, "tool_1", { type: "reject" })
    expect(first.get("tool_1")).toEqual({ type: "approve" })
    expect(second.get("tool_1")).toEqual({ type: "reject" })
    expect(second).not.toBe(first)
  })
})
