// snapshot 水合规格：只供 meta/files——线程内容由事件史全量回放重建（lastSeq=0 开流）。
import { describe, expect, it } from "vitest"

import { stateFromSnapshot } from "@/core/hydration"

import { makePendingPause, makeSnapshot } from "./fixtures"

describe("stateFromSnapshot", () => {
  it("线程内容不直投：messages/steps 空、lastSeq=0（回放起点）", () => {
    const state = stateFromSnapshot(
      makeSnapshot({
        messages: [
          { message_id: "m1", role: "user", content: "hi", status: "completed", created_at: "2026-07-02T00:00:00Z" },
          { message_id: "m2", role: "assistant", content: "yo", status: "completed", created_at: "2026-07-02T00:00:01Z" },
        ],
        pendingPauses: [makePendingPause()],
        eventWatermark: 42,
      }),
    )
    expect(state.messages).toEqual([])
    expect(state.stepsByRun).toEqual({})
    expect(state.lastSeq).toBe(0)
  })

  it("meta 与 files 透传", () => {
    const state = stateFromSnapshot(makeSnapshot({ title: "标题" }))
    expect(state.meta).toEqual({ title: "标题", ownerId: "local-user" })
    expect(state.files).toEqual([])
  })
})
