// 并发 / 跨-tab 回归（866965c）：steer 迟到回执守卫、onExternalStore 收束-跟随、
// run 收尾文件面同步。这些是无法用纯 transition 覆盖的引擎级竞态，须在真 engine 上驱动。

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { addConversation, type ConversationStore } from "@/core/conversations"
import { SessionClientError } from "@/engine/client"
import { createSessionEngine, type SessionEngine } from "@/engine/machine"

import { makeEvent, makeSnapshot, resetFixtureSeq } from "../core/fixtures"
import { createFakeClient, createMemoryStorage, settle, type FakeClient } from "./fakes"

let client: FakeClient
let storage: ReturnType<typeof createMemoryStorage<ConversationStore>>
let engine: SessionEngine

function buildEngine(initial: ConversationStore | null = null) {
  client = createFakeClient()
  storage = createMemoryStorage<ConversationStore>(initial)
  let idCounter = 0
  engine = createSessionEngine({
    client,
    storage,
    now: () => 1_000,
    createId: (prefix) => `${prefix}_${(idCounter += 1)}`,
  })
  return engine
}

async function reachStreaming(content = "hello"): Promise<void> {
  // submit → 回执归位 → streaming（有活跃 run 可插话）。
  engine.submit(content)
  await settle()
}

beforeEach(resetFixtureSeq)
afterEach(() => {
  engine.dispose()
})

describe("并发与跨-tab 回归（866965c）", () => {
  it("跨 tab 改 store 但本 tab 激活会话仍在：只吸收列表，保留在途线程、不重水合", async () => {
    const initial = addConversation(null, "conv_a", 100)
    buildEngine(initial)
    await reachStreaming()
    const threadBefore = engine.getSnapshot().thread
    const snapshotCallsBefore = client.snapshotCalls.length

    // 另一 tab 新建了 conv_b（其视角 activeId=conv_b），但 conv_a 仍在。
    const external = addConversation(initial, "conv_b", 200)
    storage.write(external)

    const after = engine.getSnapshot()
    expect(after.store?.activeId).toBe("conv_a") // 保留本 tab 激活视图
    expect(after.store?.conversations.map((c) => c.id)).toContain("conv_b") // 吸收新会话
    expect(after.thread).toBe(threadBefore) // 在途线程同引用，未重建
    expect(client.snapshotCalls.length).toBe(snapshotCallsBefore) // 未重水合
  })

  it("跨 tab 删掉本 tab 激活会话：收束在途流、跟随外部激活、重水合", async () => {
    let initial = addConversation(null, "conv_a", 100)
    initial = addConversation(initial, "conv_b", 200)
    buildEngine(initial)
    engine.selectConversation("conv_a")
    await settle()
    await reachStreaming("hi")
    const streamA = client.lastStream()
    const snapshotCallsBefore = client.snapshotCalls.length

    // 另一 tab 删了 conv_a，只剩 conv_b。
    const external: ConversationStore = {
      activeId: "conv_b",
      conversations: initial.conversations.filter((c) => c.id === "conv_b"),
    }
    storage.write(external)
    await settle()

    expect(streamA.closed).toBe(true) // 在途 run 被收束（不卡在悬空 streaming）
    expect(engine.getSnapshot().store?.activeId).toBe("conv_b") // 跟随外部激活
    expect(engine.getSnapshot().machine.phase).toBe("idle") // 旧 streaming 相位已 RESET
    expect(client.snapshotCalls.length).toBeGreaterThan(snapshotCallsBefore) // 重水合 conv_b
  })

  it("run 收尾后吸收 snapshot.files（读工作区真相，覆盖任意建文件工具）", async () => {
    buildEngine()
    client.nextSnapshot = () =>
      Promise.resolve({
        ...makeSnapshot({}),
        files: [{ path: "plan.md", mime: "text/markdown", bytes: 12 }],
      })
    await reachStreaming()

    client.lastStream().emit([makeEvent("run.completed", { status: "completed" })])
    await settle()

    expect(engine.getSnapshot().thread.files.map((f) => f.path)).toContain("plan.md")
  })

  it("steer 迟到失败在切走会话后到达：守卫拒绝，不把 steer 通知串到别的会话", async () => {
    buildEngine()
    await reachStreaming() // conv_1 streaming
    // 让 steer 的 POST 挂起，可控失败。
    let rejectSteer: (error: unknown) => void = () => {}
    client.nextCreate = () =>
      new Promise((_resolve, reject) => {
        rejectSteer = reject
      })
    engine.submit("steer me") // 插话：POST 在途，steerSessionId=conv_1
    engine.newConversation() // 切到 conv_2（POST 尚未回）
    rejectSteer(new SessionClientError("http", "boom"))
    await settle()

    // 守卫：迟到的 steer 失败通知不得落在 conv_2 上。
    expect(engine.getSnapshot().notice?.key).not.toBe("steer.sendFailed")
  })

  it("steer 失败在原会话（未切走）：通知照常可见——对照,证明上面的隔离来自守卫", async () => {
    buildEngine()
    await reachStreaming()
    let rejectSteer: (error: unknown) => void = () => {}
    client.nextCreate = () =>
      new Promise((_resolve, reject) => {
        rejectSteer = reject
      })
    engine.submit("steer me")
    rejectSteer(new SessionClientError("http", "boom"))
    await settle()

    expect(engine.getSnapshot().notice?.key).toBe("steer.sendFailed")
  })
})
