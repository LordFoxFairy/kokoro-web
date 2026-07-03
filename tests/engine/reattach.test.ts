import { describe, expect, it } from "vitest"

import { REATTACH_TIMEOUT_MS, reattachPlanFromSnapshot } from "@/engine/reattach"

import { makePendingPause, makeSnapshot } from "../core/fixtures"

describe("reattachPlanFromSnapshot", () => {
  it("snapshot 有在途 run（无暂停点）→ 普通重连计划", () => {
    const snapshot = makeSnapshot({ activeRun: { run_id: "run_1", status: "running" } })
    expect(reattachPlanFromSnapshot(snapshot)).toEqual({ runId: "run_1", awaiting: false })
  })

  it("在途 run 带 pending 暂停点 → awaiting 计划（审批卡直接可操作）", () => {
    const snapshot = makeSnapshot({
      activeRun: { run_id: "run_1", status: "waiting_input" },
      pendingPauses: [makePendingPause({ run_id: "run_1" })],
    })
    expect(reattachPlanFromSnapshot(snapshot)).toEqual({ runId: "run_1", awaiting: true })
  })

  it.each([
    ["无在途 run", makeSnapshot({})],
    ["暂停点属于历史 run", makeSnapshot({
      activeRun: { run_id: "run_1", status: "running" },
      pendingPauses: [makePendingPause({ run_id: "run_old" })],
    })],
    ["同 run 暂停点已 resolved", makeSnapshot({
      activeRun: { run_id: "run_1", status: "running" },
      pendingPauses: [makePendingPause({ run_id: "run_1", status: "resolved" })],
    })],
  ])("%s → 按实际情况判定", (_label, snapshot) => {
    const plan = reattachPlanFromSnapshot(snapshot)
    if (snapshot.active_run === undefined) {
      expect(plan).toBeNull()
    } else {
      expect(plan).toEqual({ runId: snapshot.active_run.run_id, awaiting: false })
    }
  })

  it("兜底窗口保持 90s 语义", () => {
    expect(REATTACH_TIMEOUT_MS).toBe(90_000)
  })
})
