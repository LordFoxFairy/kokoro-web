import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { addConversation, type ConversationStore } from "@/core/conversations"
import { SessionClientError } from "@/engine/client"
import { createSessionEngine, type SessionEngine } from "@/engine/machine"

import {
  awaitingPayload,
  makeEvent,
  makePendingPause,
  makeSnapshot,
  resetFixtureSeq,
} from "../core/fixtures"
import {
  createFakeClient,
  createMemoryStorage,
  makeReceipt,
  settle,
  type FakeClient,
} from "./fakes"

let client: FakeClient
let storage: ReturnType<typeof createMemoryStorage<ConversationStore>>
let engine: SessionEngine

function buildEngine(initial: ConversationStore | null = null, reattachTimeoutMs?: number) {
  client = createFakeClient()
  storage = createMemoryStorage<ConversationStore>(initial)
  let idCounter = 0
  engine = createSessionEngine({
    client,
    storage,
    now: () => 1_000,
    createId: (prefix) => `${prefix}_${(idCounter += 1)}`,
    ...(reattachTimeoutMs !== undefined ? { reattachTimeoutMs } : {}),
  })
  return engine
}

beforeEach(resetFixtureSeq)
afterEach(() => {
  engine.dispose()
})

function thread() {
  return engine.getSnapshot().thread
}

function activeEntry() {
  const store = engine.getSnapshot().store
  if (!store) {
    throw new Error("no store")
  }
  const entry = store.conversations.find((candidate) => candidate.id === store.activeId)
  if (!entry) {
    throw new Error("no active entry")
  }
  return entry
}

describe("提交链路", () => {
  it("首次提交：建会话、POST 契约体（idempotency_key）、回执锚定、事件折叠、终态收束", async () => {
    buildEngine()
    engine.submit("  hello agent  ")
    // 用户消息即时落地（不等回执）。
    expect(thread().messages).toMatchObject([{ role: "user", content: "hello agent" }])
    await settle()

    expect(client.startCalls).toHaveLength(1)
    expect(client.startCalls[0]).toEqual({
      sessionId: "conv_1",
      body: { idempotency_key: "idem_3", content: "hello agent" },
    })
    expect(engine.getSnapshot().machine).toMatchObject({ phase: "streaming", runId: "run_1" })
    // 新会话无水位：从 0 续（等价全量）。
    expect(client.lastStream()).toMatchObject({ sessionId: "conv_1", lastEventId: 0 })

    client.lastStream().emit([
      makeEvent("run.created", { run_id: "run_1" }),
      makeEvent("message.delta", { segment_id: "seg_1", delta: "hi " }),
      makeEvent("message.delta", { segment_id: "seg_1", delta: "there" }),
      makeEvent("run.completed", { status: "completed" }),
    ])
    await settle()

    expect(engine.getSnapshot().machine.phase).toBe("idle")
    expect(thread().messages.at(-1)).toMatchObject({
      role: "assistant",
      content: "hi there",
    })
    expect(client.lastStream().closed).toBe(true)
    // 列表索引落盘（标题回退派生自首条用户消息）。
    expect(storage.writes.length).toBeGreaterThan(0)
    expect(activeEntry()).toMatchObject({ id: "conv_1", title: "hello agent" })
  })

  it("session.created 的服务端标题盖过本地派生标题", async () => {
    buildEngine()
    engine.submit("local words")
    await settle()
    client.lastStream().emit([
      makeEvent("session.created", { title: "server title", owner_id: "local-user" }),
      makeEvent("run.completed", { status: "completed" }),
    ])
    await settle()
    expect(activeEntry().title).toBe("server title")
  })

  it("同步双发守卫：连续两次 submit 只发一条 POST", async () => {
    buildEngine()
    engine.submit("first")
    engine.submit("second")
    await settle()
    expect(client.startCalls).toHaveLength(1)
    expect(thread().messages).toHaveLength(1)
  })

  it.each([["   "], [""]])("空白输入 %j 不触发任何副作用", async (input) => {
    buildEngine()
    engine.submit(input)
    await settle()
    expect(client.startCalls).toHaveLength(0)
    expect(engine.getSnapshot().machine.phase).toBe("idle")
  })

  it("POST 失败进错误态，无本地假回复（零静默降级）", async () => {
    buildEngine()
    client.nextStart = () => Promise.reject(new SessionClientError("http", "status 500"))
    engine.submit("hello")
    await settle()
    expect(engine.getSnapshot().machine).toMatchObject({ phase: "error", error: "status 500" })
    expect(thread().messages.every((message) => message.role === "user")).toBe(true)
    expect(client.streams).toHaveLength(0)
  })

  it("活跃 run 409（session_run_active）显式进错误态", async () => {
    buildEngine()
    client.nextStart = () =>
      Promise.reject(new SessionClientError("http", "session_run_active"))
    engine.submit("hello")
    await settle()
    expect(engine.getSnapshot().machine).toMatchObject({
      phase: "error",
      error: "session_run_active",
    })
  })

  it("错误态可重新提交（错误即清）", async () => {
    buildEngine()
    client.nextStart = () => Promise.reject(new SessionClientError("network", "down"))
    engine.submit("hello")
    await settle()
    client.nextStart = () => Promise.resolve(makeReceipt("run_retry"))
    engine.submit("hello again")
    await settle()
    expect(engine.getSnapshot().machine).toMatchObject({ phase: "streaming", runId: "run_retry" })
  })

  it("SSE 入站未过契约 → 状态机错误态并关流", async () => {
    buildEngine()
    engine.submit("hello")
    await settle()
    client.lastStream().fail(new SessionClientError("parse", "SSE payload rejected by contract"))
    await settle()
    expect(engine.getSnapshot().machine.phase).toBe("error")
  })
})

describe("HITL 凑帧与部分拒绝", () => {
  async function enterAwaitingFrame() {
    buildEngine()
    engine.submit("do work")
    await settle()
    client.lastStream().emit([
      makeEvent("run.created", { run_id: "run_1" }),
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "a", args: {} }),
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_2", name: "b", args: {} }),
      makeEvent("tool.awaiting_approval", awaitingPayload("tool_1", ["tool_1", "tool_2"])),
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_2", ["tool_1", "tool_2"], {
          tool_id: "tool_2",
          name: "b",
          kind: "ask_user",
          allowed_decisions: ["respond"],
        }),
      ),
    ])
    await settle()
    expect(engine.getSnapshot().machine.phase).toBe("awaiting-hitl")
  }

  it("未凑齐不提交；凑齐后一次 resume 携带 decision_id 与同帧全部决策", async () => {
    await enterAwaitingFrame()
    engine.stageToolDecision("run_1", "tool_1", { type: "approve" })
    await settle()
    expect(client.controlCalls).toHaveLength(0)
    expect(engine.getSnapshot().staging["run_1"]).toEqual({ tool_1: { type: "approve" } })

    engine.stageToolDecision("run_1", "tool_2", { type: "reject" })
    await settle()
    expect(client.controlCalls).toHaveLength(1)
    expect(client.controlCalls[0]).toMatchObject({
      sessionId: "conv_1",
      runId: "run_1",
      body: {
        kind: "run.resume",
        decisions: [
          { type: "approve", tool_id: "tool_1" },
          { type: "reject", tool_id: "tool_2" },
        ],
      },
    })
    const body = client.controlCalls[0]?.body
    expect(body?.kind === "run.resume" && body.decision_id.length > 0).toBe(true)
    // 部分拒绝：被拒工具本地置 rejected（防回流翻绿勾），批准的保持 awaiting 等 agent 恢复。
    const steps = thread().stepsByRun["run_1"] ?? []
    const statusById = new Map(
      steps.flatMap((step) => (step.kind === "tool" ? [[step.tool.id, step.tool.status]] : [])),
    )
    expect(statusById.get("tool_1")).toBe("awaiting")
    expect(statusById.get("tool_2")).toBe("rejected")
    expect(engine.getSnapshot().machine.phase).toBe("streaming")
    expect(engine.getSnapshot().staging["run_1"]).toBeUndefined()
  })

  it("resume POST 失败：暂存保留可重试，重试复用同一 decision_id", async () => {
    await enterAwaitingFrame()
    client.nextControl = () => Promise.reject(new SessionClientError("http", "status 502"))
    engine.stageToolDecision("run_1", "tool_1", { type: "approve" })
    engine.stageToolDecision("run_1", "tool_2", { type: "respond", message: "use plan b" })
    await settle()
    expect(engine.getSnapshot().machine).toMatchObject({
      phase: "awaiting-hitl",
      error: "status 502",
    })
    expect(engine.getSnapshot().staging["run_1"]).toEqual({
      tool_1: { type: "approve" },
      tool_2: { type: "respond", message: "use plan b" },
    })

    client.nextControl = () => Promise.resolve({ ok: true })
    // 重试：重按同一决策（暂存仍在），第二次提交必须复用同一 decision_id（幂等）。
    engine.stageToolDecision("run_1", "tool_2", { type: "respond", message: "use plan b" })
    await settle()
    expect(client.controlCalls).toHaveLength(2)
    const [first, second] = client.controlCalls
    if (first?.body.kind !== "run.resume" || second?.body.kind !== "run.resume") {
      throw new Error("expected two resume calls")
    }
    expect(second.body.decision_id).toBe(first.body.decision_id)
    expect(engine.getSnapshot().machine.phase).toBe("streaming")
  })

  it("respond 决策映射为契约 respond(response)", async () => {
    await enterAwaitingFrame()
    engine.stageToolDecision("run_1", "tool_1", { type: "approve" })
    engine.stageToolDecision("run_1", "tool_2", { type: "respond", message: "answer" })
    await settle()
    expect(client.controlCalls[0]?.body).toMatchObject({
      kind: "run.resume",
      decisions: [
        { type: "approve", tool_id: "tool_1" },
        { type: "respond", tool_id: "tool_2", response: "answer" },
      ],
    })
  })
})

describe("停止与放弃", () => {
  it("cancelRun：本地立即收口（结构化 cancelled）、cancel POST 带 decision_id 尽力而为", async () => {
    buildEngine()
    engine.submit("long job")
    await settle()
    client.lastStream().emit([
      makeEvent("run.created", { run_id: "run_1" }),
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "a", args: {} }),
    ])
    await settle()
    engine.cancelRun()
    await settle()
    expect(client.controlCalls).toHaveLength(1)
    expect(client.controlCalls[0]).toMatchObject({
      sessionId: "conv_1",
      runId: "run_1",
      body: { kind: "run.cancel" },
    })
    const body = client.controlCalls[0]?.body
    expect(body?.kind === "run.cancel" && body.decision_id.length > 0).toBe(true)
    expect(engine.getSnapshot().machine.phase).toBe("idle")
    const step = (thread().stepsByRun["run_1"] ?? [])[0]
    expect(step?.kind === "tool" ? step.tool.status : null).toBe("cancelled")
    expect(client.lastStream().closed).toBe(true)
  })

  it("新建会话放弃在途 run（发 cancel）并置新会话为活跃、清空线程", async () => {
    buildEngine()
    engine.submit("job in conv A")
    await settle()
    const firstConvId = engine.getSnapshot().store?.activeId
    engine.newConversation()
    await settle()
    expect(client.controlCalls.at(-1)?.body).toMatchObject({ kind: "run.cancel" })
    expect(engine.getSnapshot().store?.activeId).not.toBe(firstConvId)
    expect(thread().messages).toHaveLength(0)
    // 本地新建的会话服务端必然不存在：不发无谓 snapshot 请求。
    expect(client.snapshotCalls).toHaveLength(0)
  })
})

describe("snapshot-first 水合与中断恢复", () => {
  const SEEDED = addConversation(null, "conv_9", 500)

  it("启动即 GET snapshot；无服务端会话（null）停留空态，不开流", async () => {
    buildEngine(SEEDED)
    await settle()
    expect(client.snapshotCalls).toEqual(["conv_9"])
    expect(engine.getSnapshot().machine.phase).toBe("idle")
    expect(client.streams).toHaveLength(0)
  })

  it("快照有历史消息：水合线程 + 服务端标题回填索引，无在途 run 不开流", async () => {
    buildEngine(SEEDED)
    client.nextSnapshot = () =>
      Promise.resolve(
        makeSnapshot({
          sessionId: "conv_9",
          title: "restored title",
          messages: [
            {
              message_id: "msg_u",
              role: "user",
              content: "old ask",
              status: "completed",
              created_at: "2026-07-02T00:00:00Z",
            },
            {
              message_id: "msg_a",
              role: "assistant",
              content: "old answer",
              status: "completed",
              created_at: "2026-07-02T00:00:01Z",
              run_id: "run_old",
            },
          ],
          eventWatermark: 7,
        }),
      )
    // 重建引擎以套用编程后的 snapshot。
    engine.dispose()
    engine = createSessionEngine({ client, storage, now: () => 1_000 })
    await settle()
    expect(thread().messages).toHaveLength(2)
    expect(thread().lastSeq).toBe(7)
    expect(activeEntry().title).toBe("restored title")
    expect(engine.getSnapshot().machine.phase).toBe("idle")
    expect(client.streams).toHaveLength(0)
  })

  it("快照带在途 run：锚定重连并按水位续流（Last-Event-ID=watermark）", async () => {
    buildEngine(SEEDED)
    client.nextSnapshot = () =>
      Promise.resolve(
        makeSnapshot({
          sessionId: "conv_9",
          activeRun: { run_id: "run_9", status: "running" },
          eventWatermark: 12,
        }),
      )
    engine.dispose()
    engine = createSessionEngine({ client, storage, now: () => 1_000 })
    await settle()
    expect(engine.getSnapshot().machine).toMatchObject({ phase: "reattaching", runId: "run_9" })
    expect(client.lastStream()).toMatchObject({ sessionId: "conv_9", lastEventId: 12 })

    // 历史 run 的 replay 终态不收束本轮。
    client.lastStream().emit([
      makeEvent("run.completed", { status: "completed" }, { run_id: "run_old", seq: 13 }),
    ])
    await settle()
    expect(engine.getSnapshot().machine.phase).toBe("reattaching")

    client.lastStream().emit([
      makeEvent("message.delta", { segment_id: "seg_1", delta: "resumed" }, { run_id: "run_9", seq: 14 }),
    ])
    await settle()
    expect(engine.getSnapshot().machine.phase).toBe("streaming")

    client.lastStream().emit([
      makeEvent("run.completed", { status: "completed" }, { run_id: "run_9", seq: 15 }),
    ])
    await settle()
    expect(engine.getSnapshot().machine.phase).toBe("idle")
  })

  it("刷新场景规格：带 pending pause 的快照水合后审批帧直接可操作", async () => {
    buildEngine(SEEDED)
    client.nextSnapshot = () =>
      Promise.resolve(
        makeSnapshot({
          sessionId: "conv_9",
          activeRun: { run_id: "run_9", status: "waiting_input" },
          pendingPauses: [
            makePendingPause({ run_id: "run_9", tool_id: "tool_1" }),
          ],
          eventWatermark: 20,
        }),
      )
    engine.dispose()
    engine = createSessionEngine({ client, storage, now: () => 1_000 })
    await settle()
    // 水合直接落 awaiting-hitl：审批卡可点，无需任何流事件先行。
    expect(engine.getSnapshot().machine).toMatchObject({ phase: "awaiting-hitl", runId: "run_9" })
    const step = (thread().stepsByRun["run_9"] ?? [])[0]
    expect(step?.kind === "tool" ? step.tool.status : null).toBe("awaiting")

    engine.stageToolDecision("run_9", "tool_1", { type: "approve" })
    await settle()
    expect(client.controlCalls).toHaveLength(1)
    expect(client.controlCalls[0]).toMatchObject({
      sessionId: "conv_9",
      runId: "run_9",
      body: { kind: "run.resume", decisions: [{ type: "approve", tool_id: "tool_1" }] },
    })
    expect(engine.getSnapshot().machine.phase).toBe("streaming")
  })

  it("水合失败（非 404）fail-loud 进错误态", async () => {
    buildEngine(SEEDED)
    client.nextSnapshot = () => Promise.reject(new SessionClientError("http", "status 500"))
    engine.dispose()
    engine = createSessionEngine({ client, storage, now: () => 1_000 })
    await settle()
    expect(engine.getSnapshot().machine).toMatchObject({ phase: "error", error: "status 500" })
  })

  it("切会话即重新水合目标会话", async () => {
    let store = addConversation(null, "conv_a", 100)
    store = addConversation(store, "conv_b", 200)
    buildEngine(store)
    await settle()
    expect(client.snapshotCalls).toEqual(["conv_b"])
    engine.selectConversation("conv_a")
    await settle()
    expect(client.snapshotCalls).toEqual(["conv_b", "conv_a"])
    expect(engine.getSnapshot().store?.activeId).toBe("conv_a")
  })

  it("90s 兜底：重连窗口内无终态则放弃续传", async () => {
    vi.useFakeTimers()
    try {
      buildEngine(SEEDED)
      client.nextSnapshot = () =>
        Promise.resolve(
          makeSnapshot({
            sessionId: "conv_9",
            activeRun: { run_id: "run_9", status: "running" },
          }),
        )
      engine.dispose()
      engine = createSessionEngine({ client, storage, now: () => 1_000 })
      await vi.advanceTimersByTimeAsync(0)
      expect(engine.getSnapshot().machine.phase).toBe("reattaching")
      await vi.advanceTimersByTimeAsync(90_000)
      expect(engine.getSnapshot().machine.phase).toBe("idle")
      expect(client.lastStream().closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it("水合落在待批帧时不设兜底超时（用户决策不限时）", async () => {
    vi.useFakeTimers()
    try {
      buildEngine(SEEDED)
      client.nextSnapshot = () =>
        Promise.resolve(
          makeSnapshot({
            sessionId: "conv_9",
            activeRun: { run_id: "run_9", status: "waiting_input" },
            pendingPauses: [makePendingPause({ run_id: "run_9" })],
          }),
        )
      engine.dispose()
      engine = createSessionEngine({ client, storage, now: () => 1_000 })
      await vi.advanceTimersByTimeAsync(0)
      expect(engine.getSnapshot().machine.phase).toBe("awaiting-hitl")
      await vi.advanceTimersByTimeAsync(90_000)
      expect(engine.getSnapshot().machine.phase).toBe("awaiting-hitl")
    } finally {
      vi.useRealTimers()
    }
  })

  it("落盘漂移：storage 读出 null 时引擎从空态启动，不水合不开流", async () => {
    buildEngine(null)
    await settle()
    expect(engine.getSnapshot().store).toBeNull()
    expect(engine.getSnapshot().machine.phase).toBe("idle")
    expect(client.snapshotCalls).toHaveLength(0)
    expect(client.streams).toHaveLength(0)
  })
})

describe("失败重试", () => {
  it("POST 失败后 retry：复用同一 idempotency_key（服务端命中即重放 receipt）", async () => {
    buildEngine()
    client.nextStart = () => Promise.reject(new SessionClientError("http", "status 500"))
    engine.submit("hello")
    await settle()
    expect(engine.getSnapshot().machine.phase).toBe("error")

    client.nextStart = () => Promise.resolve(makeReceipt("run_retry"))
    engine.retry()
    await settle()
    expect(client.startCalls).toHaveLength(2)
    expect(client.startCalls[1]?.body.content).toBe("hello")
    expect(client.startCalls[1]?.body.idempotency_key).toBe(
      client.startCalls[0]?.body.idempotency_key,
    )
    expect(thread().messages).toHaveLength(1)
    expect(engine.getSnapshot().machine).toMatchObject({ phase: "streaming", runId: "run_retry" })
  })

  it("run.failed 终态后 retry：换新 idempotency_key 重新开跑（旧 run 已真实失败）", async () => {
    buildEngine()
    engine.submit("job")
    await settle()
    client.lastStream().emit([
      makeEvent("run.created", { run_id: "run_1" }),
      makeEvent("run.failed", { error_kind: "boom", message: "agent exploded" }),
    ])
    await settle()
    expect(thread().runStatus).toBe("failed")
    expect(engine.getSnapshot().machine.phase).toBe("idle")

    engine.retry()
    expect(thread().runStatus).toBe("idle")
    await settle()
    expect(client.startCalls).toHaveLength(2)
    expect(client.startCalls[1]?.body.content).toBe("job")
    expect(client.startCalls[1]?.body.idempotency_key).not.toBe(
      client.startCalls[0]?.body.idempotency_key,
    )
  })

  it.each([
    ["无用户消息", () => {}],
    ["流式中（双发守卫）", (target: SessionEngine) => target.submit("go")],
  ])("retry 边界：%s 时不产生额外 POST", async (_label, arrange) => {
    buildEngine()
    arrange(engine)
    await settle()
    const callsBefore = client.startCalls.length
    engine.retry()
    await settle()
    expect(client.startCalls.length).toBe(callsBefore)
  })
})

describe("模式（纯 UI 偏好，不上 wire）", () => {
  it("空首屏选模式落 pendingMode，首会话承接并随开聊锁定", async () => {
    buildEngine()
    engine.setMode("thinking")
    expect(engine.getSnapshot().pendingMode).toBe("thinking")
    engine.submit("go")
    await settle()
    expect(activeEntry().mode).toBe("thinking")
    // POST 体只有 idempotency_key/content：模式不进 wire。
    expect(Object.keys(client.startCalls[0]?.body ?? {}).sort()).toEqual([
      "content",
      "idempotency_key",
    ])
    // 已开聊锁定：切换被忽略。
    engine.setMode("fast")
    expect(activeEntry().mode).toBe("thinking")
  })
})
