import { describe, expect, it } from "vitest"

import { stateFromSnapshot } from "@/core/hydration"

import { makePendingPause, makeSnapshot } from "./fixtures"

describe("stateFromSnapshot：snapshot 是权威读取模型", () => {
  it("messages/active_run/watermark/meta 全量水合", () => {
    const state = stateFromSnapshot(
      makeSnapshot({
        title: "server title",
        messages: [
          {
            message_id: "msg_u",
            role: "user",
            content: "hi",
            status: "completed",
            created_at: "2026-07-02T00:00:00Z",
          },
          {
            message_id: "msg_a",
            role: "assistant",
            content: "done answer",
            status: "completed",
            created_at: "2026-07-02T00:00:01Z",
            run_id: "run_old",
          },
        ],
        activeRun: { run_id: "run_1", status: "running" },
        eventWatermark: 42,
      }),
    )
    expect(state.messages).toEqual([
      { id: "msg_u", role: "user", content: "hi", runId: "msg_u" },
      { id: "msg_a", role: "assistant", content: "done answer", runId: "run_old" },
    ])
    expect(state.activeRunId).toBe("run_1")
    expect(state.lastSeq).toBe(42)
    expect(state.meta).toEqual({ title: "server title", ownerId: "local-user" })
    expect(state.seenEventIds.size).toBe(0)
  })

  it.each([
    ["pending", true],
    ["streaming", true],
    ["completed", false],
    ["failed", false],
  ] as const)("assistant 消息 status=%s → hydratedStreaming=%s", (status, expected) => {
    const state = stateFromSnapshot(
      makeSnapshot({
        messages: [
          {
            message_id: "msg_a",
            role: "assistant",
            content: "",
            status,
            created_at: "2026-07-02T00:00:00Z",
            run_id: "run_1",
          },
        ],
      }),
    )
    expect(state.messages[0]?.hydratedStreaming ?? false).toBe(expected)
  })

  it("pending pause → awaiting 工具步：同 run 全部 pause 构成同帧 pending_tool_ids", () => {
    const state = stateFromSnapshot(
      makeSnapshot({
        activeRun: { run_id: "run_1", status: "waiting_input" },
        pendingPauses: [
          makePendingPause({ pause_id: "p1", tool_id: "tool_1" }),
          makePendingPause({
            pause_id: "p2",
            tool_id: "tool_2",
            tool_name: "ask_user",
            kind: "ask_user",
            allowed_decisions: ["respond"],
            args: { question: "which?", choices: ["a", "b"] },
          }),
        ],
      }),
    )
    const steps = state.stepsByRun["run_1"] ?? []
    expect(steps).toHaveLength(2)
    const tools = steps.flatMap((step) => (step.kind === "tool" ? [step.tool] : []))
    expect(tools[0]).toMatchObject({
      id: "tool_1",
      status: "awaiting",
      awaitingKind: "tool_approval",
      pendingToolIds: ["tool_1", "tool_2"],
    })
    expect(tools[1]).toMatchObject({
      id: "tool_2",
      status: "awaiting",
      awaitingKind: "ask_user",
      allowedDecisions: ["respond"],
      pendingToolIds: ["tool_1", "tool_2"],
    })
  })

  it("非 pending 的 pause（已决/取消/过期）不生成 awaiting 步", () => {
    const state = stateFromSnapshot(
      makeSnapshot({
        pendingPauses: [
          makePendingPause({ pause_id: "p1", tool_id: "tool_1", status: "resolved" }),
          makePendingPause({ pause_id: "p2", tool_id: "tool_2", status: "cancelled" }),
        ],
      }),
    )
    expect(state.stepsByRun).toEqual({})
  })

  it("risk/input_schema 可选字段透传到工具步", () => {
    const state = stateFromSnapshot(
      makeSnapshot({
        pendingPauses: [
          makePendingPause({
            risk: { level: "high", source: "policy", reason: "writes fs" },
            input_schema: { type: "object" },
          }),
        ],
      }),
    )
    const step = (state.stepsByRun["run_1"] ?? [])[0]
    if (step?.kind !== "tool") {
      throw new Error("expected tool step")
    }
    expect(step.tool.risk).toEqual({ level: "high", source: "policy", reason: "writes fs" })
    expect(step.tool.inputSchema).toEqual({ type: "object" })
  })

  it("空快照（无消息无 run）水合为干净空态", () => {
    const state = stateFromSnapshot(makeSnapshot({}))
    expect(state.messages).toEqual([])
    expect(state.activeRunId).toBeNull()
    expect(state.runStatus).toBe("idle")
    expect(state.todos).toEqual([])
  })
})
