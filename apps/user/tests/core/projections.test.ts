import { beforeEach, describe, expect, it } from "vitest"

import { buildThreadItems, groupSegments } from "@/core/projections"
import { applySessionEvents, appendUserMessage } from "@/core/reducer"
import { createSessionStreamState, type SessionStep } from "@/core/state"

import { makeEvent, resetFixtureSeq } from "./fixtures"

beforeEach(resetFixtureSeq)

describe("buildThreadItems", () => {
  it("用户消息单独成项，连续同 run assistant 段归并为一个 turn", () => {
    let state = appendUserMessage(createSessionStreamState(), { id: "usr_1", content: "hi" })
    state = applySessionEvents(state, [
      makeEvent("message.delta", { segment_id: "seg_1", delta: "a" }, { run_id: "run_1" }),
      makeEvent("message.delta", { segment_id: "seg_2", delta: "b" }, { run_id: "run_1" }),
    ])
    const items = buildThreadItems(state)
    expect(items.map((item) => item.kind)).toEqual(["user", "assistant-turn"])
    const turn = items[1]
    if (turn?.kind !== "assistant-turn") {
      throw new Error("expected assistant-turn")
    }
    expect(Object.keys(turn.messagesById).sort()).toEqual(["seg_1", "seg_2"])
  })

  it("仅有过程步骤、尚无文本的 run 作为无文本成形 turn", () => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("thinking.delta", { segment_id: "seg_1", delta: "plan" }, { run_id: "run_x" }),
    ])
    const items = buildThreadItems(state)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: "assistant-turn", runId: "run_x" })
  })

  it("持久化快照缺 text 步骤时按 message 合成渲染锚点", () => {
    let state = applySessionEvents(createSessionStreamState(), [
      makeEvent("message.completed", { segment_id: "seg_1", content: "answer" }),
    ])
    // 模拟旧落盘丢失 text 步骤。
    state = { ...state, stepsByRun: { ...state.stepsByRun, run_1: [] } }
    const items = buildThreadItems(state)
    const turn = items[0]
    if (turn?.kind !== "assistant-turn") {
      throw new Error("expected assistant-turn")
    }
    expect(turn.steps.some((step) => step.kind === "text" && step.segmentId === "seg_1")).toBe(
      true,
    )
  })
})

describe("groupSegments", () => {
  it("按 segmentId 聚合并保持首次出现顺序", () => {
    const steps: SessionStep[] = [
      { kind: "thinking", seq: 1, segmentId: "seg_1", text: "think " },
      {
        kind: "tool",
        seq: 2,
        segmentId: "seg_1",
        tool: { id: "tool_1", name: "search", args: {}, status: "done" },
      },
      { kind: "text", seq: 3, segmentId: "seg_1" },
      { kind: "thinking", seq: 4, segmentId: "seg_2", text: "more" },
      { kind: "thinking", seq: 5, segmentId: "seg_1", text: "late" },
    ]
    const segments = groupSegments(steps)
    expect(segments.map((segment) => segment.segmentId)).toEqual(["seg_1", "seg_2"])
    expect(segments[0]?.thinking).toBe("think late")
    expect(segments[0]?.tools.map((tool) => tool.id)).toEqual(["tool_1"])
  })

  it.each([
    ["空步骤", [] as SessionStep[], 0],
    ["仅 text 步骤", [{ kind: "text", seq: 1, segmentId: "seg_1" }] as SessionStep[], 1],
  ])("%s → %d 段", (_label, steps, expected) => {
    expect(groupSegments(steps)).toHaveLength(expected)
  })
})
