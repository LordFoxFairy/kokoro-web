import { describe, expect, it } from "vitest"

import {
  IDLE_MACHINE,
  transition,
  type MachineEvent,
  type MachineState,
} from "@/engine/machine"

function state(partial: Partial<MachineState>): MachineState {
  return { ...IDLE_MACHINE, ...partial }
}

describe("transition 全迁移矩阵", () => {
  it.each<[string, MachineState, MachineEvent, Partial<MachineState> | "identity"]>([
    // 提交链路
    ["idle 提交", IDLE_MACHINE, { type: "SUBMIT" }, { phase: "submitting" }],
    ["error 可重新提交", state({ phase: "error", error: "x" }), { type: "SUBMIT" }, { phase: "submitting", error: null }],
    ["submitting 双发被拒", state({ phase: "submitting" }), { type: "SUBMIT" }, "identity"],
    ["streaming 双发被拒", state({ phase: "streaming", runId: "r1" }), { type: "SUBMIT" }, "identity"],
    ["awaiting-hitl 双发被拒", state({ phase: "awaiting-hitl", runId: "r1" }), { type: "SUBMIT" }, "identity"],
    ["回执锚定 runId", state({ phase: "submitting" }), { type: "RECEIPT", runId: "r1" }, { phase: "streaming", runId: "r1" }],
    ["非 submitting 的迟到回执被拒", state({ phase: "streaming", runId: "r1" }), { type: "RECEIPT", runId: "r2" }, "identity"],
    // 重连链路
    ["idle 进入重连", IDLE_MACHINE, { type: "REATTACH", runId: "r1" }, { phase: "reattaching", runId: "r1" }],
    ["snapshot 带 pending pause：重连直接落 awaiting-hitl", IDLE_MACHINE, { type: "REATTACH", runId: "r1", awaiting: true }, { phase: "awaiting-hitl", runId: "r1" }],
    ["流式中不可重连", state({ phase: "streaming", runId: "r1" }), { type: "REATTACH", runId: "r2" }, "identity"],
    ["重连首个本轮事件转流式", state({ phase: "reattaching", runId: "r1" }), { type: "STREAM_EVENT", runId: "r1", kind: "message.delta" }, { phase: "streaming", runId: "r1" }],
    ["重连中历史 run 事件不退出重连", state({ phase: "reattaching", runId: "r1" }), { type: "STREAM_EVENT", runId: "r_old", kind: "message.delta" }, "identity"],
    ["重连兜底超时收口", state({ phase: "reattaching", runId: "r1" }), { type: "TIMEOUT" }, { phase: "idle", runId: null }],
    ["idle 忽略超时", IDLE_MACHINE, { type: "TIMEOUT" }, "identity"],
    // runId 锚定收束
    ["本轮终态收束", state({ phase: "streaming", runId: "r1" }), { type: "STREAM_EVENT", runId: "r1", kind: "run.completed" }, { phase: "idle", runId: null }],
    ["历史 run 终态不收束", state({ phase: "streaming", runId: "r1" }), { type: "STREAM_EVENT", runId: "r_old", kind: "run.completed" }, "identity"],
    ["run.failed 同样收束", state({ phase: "streaming", runId: "r1" }), { type: "STREAM_EVENT", runId: "r1", kind: "run.failed" }, { phase: "idle" }],
    ["awaiting-hitl 的本轮终态强制收束", state({ phase: "awaiting-hitl", runId: "r1" }), { type: "STREAM_EVENT", runId: "r1", kind: "run.completed" }, { phase: "idle" }],
    // HITL
    ["待批事件进入 awaiting-hitl", state({ phase: "streaming", runId: "r1" }), { type: "STREAM_EVENT", runId: "r1", kind: "tool.awaiting_approval" }, { phase: "awaiting-hitl", runId: "r1" }],
    ["重连直接落在待批帧", state({ phase: "reattaching", runId: "r1" }), { type: "STREAM_EVENT", runId: "r1", kind: "tool.awaiting_approval" }, { phase: "awaiting-hitl" }],
    ["重复待批事件保持相位", state({ phase: "awaiting-hitl", runId: "r1" }), { type: "STREAM_EVENT", runId: "r1", kind: "tool.awaiting_approval" }, "identity"],
    ["resume 提交回到流式", state({ phase: "awaiting-hitl", runId: "r1" }), { type: "RESUME_SENT" }, { phase: "streaming", runId: "r1" }],
    ["非待批相位忽略 resume", state({ phase: "streaming", runId: "r1" }), { type: "RESUME_SENT" }, "identity"],
    ["control 失败原相位记错误", state({ phase: "awaiting-hitl", runId: "r1" }), { type: "CONTROL_FAILED", error: "500" }, { phase: "awaiting-hitl", runId: "r1", error: "500" }],
    // 错误与复位
    ["任意相位失败进错误态", state({ phase: "streaming", runId: "r1" }), { type: "FAIL", error: "boom" }, { phase: "error", runId: null, error: "boom" }],
    ["复位回 idle", state({ phase: "error", error: "boom" }), { type: "RESET" }, { phase: "idle", error: null }],
    ["idle 复位返回同一引用", IDLE_MACHINE, { type: "RESET" }, "identity"],
    ["idle 相位忽略流事件", IDLE_MACHINE, { type: "STREAM_EVENT", runId: "r1", kind: "message.delta" }, "identity"],
  ])("%s", (_label, before, event, expected) => {
    const after = transition(before, event)
    if (expected === "identity") {
      expect(after).toBe(before)
      return
    }
    expect(after).toMatchObject(expected)
  })

  it("同步双发守卫：第二次 SUBMIT 返回入参引用", () => {
    const first = transition(IDLE_MACHINE, { type: "SUBMIT" })
    const second = transition(first, { type: "SUBMIT" })
    expect(first.phase).toBe("submitting")
    expect(second).toBe(first)
  })
})