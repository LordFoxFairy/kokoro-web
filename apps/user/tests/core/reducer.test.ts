import { beforeEach, describe, expect, it } from "vitest"

import { parseSessionEvent, type SessionEvent } from "@/contract/session-events"
import { stateFromSnapshot } from "@/core/hydration"
import {
  applySessionEvent,
  applySessionEvents,
  appendUserMessage,
  markRunCancelled,
  markToolRejected,
} from "@/core/reducer"
import { createSessionStreamState, type SessionStreamState } from "@/core/state"

import {
  awaitingPayload,
  makeEvent,
  makeSnapshot,
  makeSnapshotDelivery,
  resetFixtureSeq,
} from "./fixtures"

beforeEach(resetFixtureSeq)

function toolStatusOf(state: SessionStreamState, runId: string, toolId: string) {
  const steps = state.stepsByRun[runId] ?? []
  for (const step of steps) {
    if (step.kind === "tool" && step.tool.id === toolId) {
      return step.tool.status
    }
  }
  return null
}

describe("event_id 幂等去重", () => {
  it("同一 event_id 第二次折叠原样返回同一引用", () => {
    const event = makeEvent("message.delta", { segment_id: "seg_1", delta: "hi" })
    const once = applySessionEvent(createSessionStreamState(), event)
    const twice = applySessionEvent(once, event)
    expect(twice).toBe(once)
    expect(once.messages).toHaveLength(1)
    expect(once.messages[0]?.content).toBe("hi")
  })

  it("批内重复 event_id 只折叠一次", () => {
    const event = makeEvent("message.delta", { segment_id: "seg_1", delta: "hi" })
    const state = applySessionEvents(createSessionStreamState(), [event, event, event])
    expect(state.messages[0]?.content).toBe("hi")
  })
})

describe("replay 收敛", () => {
  function fullRun(): SessionEvent[] {
    return [
      makeEvent("session.created", { title: "topic", owner_id: "local-user" }),
      makeEvent("run.created", { run_id: "run_1" }),
      makeEvent("thinking.delta", { segment_id: "seg_1", delta: "plan " }),
      makeEvent("thinking.delta", { segment_id: "seg_1", delta: "steps" }),
      makeEvent("tool.invoked", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "search",
        args: { q: "x" },
      }),
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "search",
        result: "ok",
        is_error: false,
      }),
      makeEvent("message.delta", { segment_id: "seg_2", delta: "half" }),
      makeEvent("message.completed", { segment_id: "seg_2", content: "full answer" }),
      makeEvent("todo.updated", {
        todos: [{ content: "step", status: "completed" }],
      }),
      makeEvent("run.completed", { status: "completed", token_usage: null }),
    ]
  }

  it("整批折叠与逐事件折叠等价", () => {
    const events = fullRun()
    const batched = applySessionEvents(createSessionStreamState(), events)
    const oneByOne = events.reduce(applySessionEvent, createSessionStreamState())
    expect(batched).toEqual(oneByOne)
  })

  it("重复 replay 同一批事件收敛到相同状态", () => {
    const events = fullRun()
    const once = applySessionEvents(createSessionStreamState(), events)
    const replayed = applySessionEvents(once, events)
    expect(replayed).toBe(once)
  })

  it("message.completed 覆盖累计增量，replay 不残留半句", () => {
    const state = applySessionEvents(createSessionStreamState(), fullRun())
    const message = state.messages.find((m) => m.id === "seg_2")
    expect(message?.content).toBe("full answer")
    expect(state.runStatus).toBe("completed")
  })

  it("lastSeq 随折叠推进到批内最大 seq（续流水位）", () => {
    const state = applySessionEvents(createSessionStreamState(), fullRun())
    expect(state.lastSeq).toBe(10)
  })
})

describe("session.created / run.created 投影", () => {
  it("session.created 投影服务端元数据（标题真源）", () => {
    const state = applySessionEvent(
      createSessionStreamState(),
      makeEvent("session.created", { title: "server title", owner_id: "owner_9" }),
    )
    expect(state.meta).toEqual({ title: "server title", ownerId: "owner_9" })
  })

  it("run.created 解析记账但不投影（run 锚定由 receipt/snapshot 承担）", () => {
    const state = applySessionEvent(
      createSessionStreamState(),
      makeEvent("run.created", { run_id: "run_9" }, { run_id: "run_9" }),
    )
    expect(state.activeRunId).toBeNull()
    expect(state.messages).toHaveLength(0)
    expect(state.seenEventIds.size).toBe(1)
  })
})

describe("乱序 seq 稳定插入", () => {
  it("迟到的低 seq 步骤插入到正确位置", () => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("message.delta", { segment_id: "seg_2", delta: "answer" }, { seq: 7 }),
      makeEvent(
        "tool.invoked",
        { segment_id: "seg_1", tool_id: "tool_1", name: "search", args: {} },
        { seq: 5 },
      ),
    ])
    const kinds = (state.stepsByRun["run_1"] ?? []).map((step) => step.kind)
    expect(kinds).toEqual(["tool", "text"])
  })

  it("同 seq 保持到达先后（稳定追加）", () => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("thinking.delta", { segment_id: "seg_a", delta: "a" }, { seq: 3, event_id: "e1" }),
      makeEvent("thinking.delta", { segment_id: "seg_b", delta: "b" }, { seq: 3, event_id: "e2" }),
    ])
    const segmentIds = (state.stepsByRun["run_1"] ?? []).map((step) => step.segmentId)
    expect(segmentIds).toEqual(["seg_a", "seg_b"])
  })
})

describe("activeRunId 显式锚定（snapshot 置位、终态清空）", () => {
  it("snapshot 水合置位、匹配终态清空", () => {
    let state = stateFromSnapshot(
      makeSnapshot({ activeRun: { run_id: "run_9", status: "running" }, eventWatermark: 3 }),
    )
    expect(state.activeRunId).toBe("run_9")
    state = applySessionEvent(
      state,
      makeEvent("run.completed", { status: "completed" }, { run_id: "run_9" }),
    )
    expect(state.activeRunId).toBeNull()
  })

  it("历史 run 的终态不清空在途锚点", () => {
    let state = stateFromSnapshot(
      makeSnapshot({ activeRun: { run_id: "run_new", status: "running" } }),
    )
    state = applySessionEvent(
      state,
      makeEvent("run.failed", { code: "internal_error", error_kind: "x", message: "boom" }, { run_id: "run_old" }),
    )
    expect(state.activeRunId).toBe("run_new")
  })

  it("历史 run 的终态不覆写在途 run 的全局 runStatus/runError", () => {
    let state = stateFromSnapshot(
      makeSnapshot({ activeRun: { run_id: "run_new", status: "running" } }),
    )
    expect(state.runStatus).toBe("idle")
    state = applySessionEvent(
      state,
      makeEvent("run.failed", { code: "internal_error", error_kind: "x", message: "boom" }, { run_id: "run_old" }),
    )
    // 在途 run_new 仍在跑，历史 run_old 失败不得把 thread 置 failed（否则 UI 弹历史假失败卡）。
    expect(state.runStatus).toBe("idle")
    expect(state.runError).toBeNull()
  })
})


describe("工具步按 tool_id 归并（segment 漂移免疫）", () => {
  it("awaiting→invoked→returned 跨 segment 仍是单步单组（真栈走查回归）", () => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("tool.awaiting_approval", { ...awaitingPayload("tool_1", ["tool_1"]), segment_id: "seg_msg" }),
      // agent 在 approve 恢复后以 tool_call_id 兜底 segment：与 awaiting 的 segment 漂移。
      makeEvent("tool.invoked", { segment_id: "tool_1", tool_id: "tool_1", name: "w", args: { a: 1 } }),
      makeEvent("tool.returned", { segment_id: "tool_1", tool_id: "tool_1", name: "w", result: "ok", is_error: false }),
    ])
    const steps = state.stepsByRun["run_1"] ?? []
    const toolSteps = steps.filter((s) => s.kind === "tool")
    expect(toolSteps).toHaveLength(1)
    expect(toolSteps[0]!.segmentId).toBe("seg_msg")
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe("done")
  })
})

describe("HITL：rejected 不被降级", () => {
  it("本地 rejected 后 is_error=false 的 tool.returned 不翻绿勾", () => {
    let state = applySessionEvents(createSessionStreamState(), [
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "w", args: {} }),
      makeEvent("tool.awaiting_approval", awaitingPayload("tool_1", ["tool_1"])),
    ])
    state = markToolRejected(state, "run_1", ["tool_1"])
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe("rejected")
    state = applySessionEvent(
      state,
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "w",
        result: "user rejected",
        is_error: false,
      }),
    )
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe("rejected")
  })

  it.each([
    [{ rejected: true }, "rejected"],
    [{ rejected: true, reject_reason: "no" }, "rejected"],
    [{}, "done"],
  ] as const)("tool.returned 契约 rejected 字段 %j → %s", (extra, expected) => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "w", args: {} }),
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "w",
        result: "r",
        is_error: false,
        ...extra,
      }),
    ])
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe(expected)
  })

  it("markToolRejected 只翻命中且 awaiting 的工具（同帧部分拒绝）", () => {
    let state = applySessionEvents(createSessionStreamState(), [
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "a", args: {} }),
      makeEvent("tool.awaiting_approval", awaitingPayload("tool_1", ["tool_1", "tool_2"])),
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_2", name: "b", args: {} }),
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_2", ["tool_1", "tool_2"], { tool_id: "tool_2", name: "b" }),
      ),
    ])
    state = markToolRejected(state, "run_1", ["tool_2"])
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe("awaiting")
    expect(toolStatusOf(state, "run_1", "tool_2")).toBe("rejected")
  })

  it("kind=input 校验失败重问：重发 awaiting 刷新 args（validation_error 上卡、schema 保持）", () => {
    const schema = {
      type: "object",
      properties: { otp: { type: "string" } },
      required: ["otp"],
    }
    const base = {
      kind: "input" as const,
      allowed_decisions: ["submit", "reject"] as ("submit" | "reject")[],
      input_schema: schema,
    }
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_1", ["tool_1"], { ...base, args: { message: "需要验证码" } }),
      ),
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_1", ["tool_1"], {
          ...base,
          args: { message: "需要验证码", validation_error: "'otp' is a required property" },
        }),
      ),
    ])
    const step = (state.stepsByRun["run_1"] ?? [])[0]
    if (step?.kind !== "tool") {
      throw new Error("expected tool step")
    }
    expect(step.tool.status).toBe("awaiting")
    expect(step.tool.args["validation_error"]).toBe("'otp' is a required property")
    expect(step.tool.inputSchema).toEqual(schema)
    expect(step.tool.awaitingKind).toBe("input")
  })

  it("awaiting 事件把契约 pending_tool_ids/kind/risk 落进工具（凑帧与分卡判据）", () => {
    const state = applySessionEvent(
      createSessionStreamState(),
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_1", ["tool_1", "tool_2"], {
          kind: "ask_user_question",
          allowed_decisions: ["respond"],
          risk: { level: "low", source: "policy", reason: "asks user" },
        }),
      ),
    )
    const step = (state.stepsByRun["run_1"] ?? [])[0]
    if (step?.kind !== "tool") {
      throw new Error("expected tool step")
    }
    expect(step.tool.pendingToolIds).toEqual(["tool_1", "tool_2"])
    expect(step.tool.awaitingKind).toBe("ask_user_question")
    expect(step.tool.risk).toEqual({ level: "low", source: "policy", reason: "asks user" })
  })

  it("result_review 的 awaiting 事件把待审 result 预填进工具步", () => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "w", args: {} }),
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_1", ["tool_1"], {
          kind: "result_review",
          allowed_decisions: ["approve", "respond", "reject"],
          result: "raw tool output",
        }),
      ),
    ])
    const step = (state.stepsByRun["run_1"] ?? [])[0]
    if (step?.kind !== "tool") {
      throw new Error("expected tool step")
    }
    expect(step.tool.status).toBe("awaiting")
    expect(step.tool.awaitingKind).toBe("result_review")
    expect(step.tool.result).toBe("raw tool output")
  })

  it("result_review 裁决回流：tool.returned 覆盖预填 result 为裁决后内容", () => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_1", ["tool_1"], {
          kind: "result_review",
          allowed_decisions: ["approve", "respond", "reject"],
          result: "raw tool output",
        }),
      ),
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "write_file",
        result: "human replacement",
        is_error: false,
        responded: true,
      }),
    ])
    const step = (state.stepsByRun["run_1"] ?? [])[0]
    if (step?.kind !== "tool") {
      throw new Error("expected tool step")
    }
    expect(step.tool.status).toBe("done")
    expect(step.tool.result).toBe("human replacement")
    expect(step.tool.responded).toBe(true)
  })
})

describe("终态收口：结构化 status、零 UI 文案", () => {
  it.each([
    ["awaiting", "stale-awaiting"],
    ["running", "stale-running"],
  ] as const)("run.completed 时 %s 工具 → %s", (openStatus, expected) => {
    const events: SessionEvent[] = [
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "w", args: {} }),
    ]
    if (openStatus === "awaiting") {
      events.push(makeEvent("tool.awaiting_approval", awaitingPayload("tool_1", ["tool_1"])))
    }
    events.push(makeEvent("run.completed", { status: "completed" }))
    const state = applySessionEvents(createSessionStreamState(), events)
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe(expected)
    const step = (state.stepsByRun["run_1"] ?? [])[0]
    expect(step?.kind === "tool" ? step.tool.errorText : "sentinel").toBeUndefined()
  })

  it("已落定（done/error/rejected）的工具不被终态收口改写", () => {
    let state = applySessionEvents(createSessionStreamState(), [
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "w", args: {} }),
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "w",
        result: "boom",
        is_error: true,
      }),
    ])
    state = applySessionEvent(
      state,
      makeEvent("run.failed", { code: "internal_error", error_kind: "agent", message: "died" }),
    )
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe("error")
    expect(state.runStatus).toBe("failed")
  })

  it("markRunCancelled 把悬挂工具置结构化 cancelled", () => {
    let state = applySessionEvents(createSessionStreamState(), [
      makeEvent("tool.invoked", { segment_id: "seg_1", tool_id: "tool_1", name: "w", args: {} }),
      makeEvent("tool.awaiting_approval", awaitingPayload("tool_1", ["tool_1"])),
    ])
    state = markRunCancelled(state, "run_1")
    expect(toolStatusOf(state, "run_1", "tool_1")).toBe("cancelled")
  })
})

describe("message.user 与本地 echo 对齐（SSE/receipt 竞态）", () => {
  it("事件先于 receipt 到达：吸收未对齐的本地 echo（改 id），不产生双份", () => {
    // steer 常态：流早已开着，publishLive 先于 HTTP 回执返回。
    let state = appendUserMessage(createSessionStreamState(), { id: "usr_1", content: "顺便注意编码" })
    state = applySessionEvent(
      state,
      makeEvent("message.user", { message_id: "msg_steer_k1", content: "顺便注意编码" }),
    )
    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]).toMatchObject({ id: "msg_steer_k1", role: "user", content: "顺便注意编码" })
  })

  it("receipt 先对齐过 id：事件按 id 命中更新，不新建", () => {
    let state = appendUserMessage(createSessionStreamState(), { id: "usr_1", content: "hi" })
    state = { ...state, messages: [{ ...state.messages[0]!, id: "msg_u1" }] }
    state = applySessionEvent(state, makeEvent("message.user", { message_id: "msg_u1", content: "hi" }))
    expect(state.messages).toHaveLength(1)
  })

  it("内容不同的本地 echo 不被误吸收（刷新回放新建）", () => {
    let state = appendUserMessage(createSessionStreamState(), { id: "usr_1", content: "draft still pending" })
    state = applySessionEvent(
      state,
      makeEvent("message.user", { message_id: "msg_old", content: "earlier turn" }),
    )
    expect(state.messages).toHaveLength(2)
    expect(state.messages.map((m) => m.id)).toEqual(["usr_1", "msg_old"])
  })
})

describe("subagent 生命周期", () => {
  it("started → 增量续写 → finished(failed) 保留错误归属", () => {
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("subagent.started", {
        segment_id: "seg_1",
        subagent_id: "sub_1",
        name: "researcher",
        description: "digs",
        subagent_type: "general",
        source: "built-in",
      }),
      makeEvent("subagent.text.delta", { segment_id: "seg_1", subagent_id: "sub_1", text: "a" }),
      makeEvent("subagent.text.delta", { segment_id: "seg_1", subagent_id: "sub_1", text: "b" }),
      makeEvent("subagent.finished", {
        segment_id: "seg_1",
        subagent_id: "sub_1",
        name: "researcher",
        subagent_type: "general",
        source: "built-in",
        failed: true,
        error: "crashed",
      }),
    ])
    const step = (state.stepsByRun["run_1"] ?? [])[0]
    expect(step?.kind === "subagent" ? step.subagent : null).toMatchObject({
      output: "ab",
      status: "failed",
      error: "crashed",
    })
  })
})

describe("delivery.created 归约（成果累积）", () => {
  it("append：payload 字段映射 + createdAt 取信封 timestamp + note 透传", () => {
    const state = applySessionEvent(
      createSessionStreamState(),
      makeEvent(
        "delivery.created",
        {
          path: "out/report.md",
          title: "调研报告",
          mime: "text/markdown",
          size: 2048,
          content_hash: "hash_a",
          note: "第二轮成果",
        },
        { timestamp: "2026-07-09T08:00:00Z" },
      ),
    )
    expect(state.deliveries).toEqual([
      {
        contentHash: "hash_a",
        path: "out/report.md",
        title: "调研报告",
        mime: "text/markdown",
        size: 2048,
        createdAt: "2026-07-09T08:00:00Z",
        note: "第二轮成果",
      },
    ])
  })

  it("contentHash 幂等：同 hash 不同 event_id 只入账一次；不同 hash 依序累积", () => {
    const base = {
      path: "out/report.md",
      title: "调研报告",
      mime: "text/markdown",
      size: 2048,
    }
    const state = applySessionEvents(createSessionStreamState(), [
      makeEvent("delivery.created", { ...base, content_hash: "hash_a" }),
      makeEvent("delivery.created", { ...base, content_hash: "hash_a" }),
      makeEvent("delivery.created", { ...base, title: "终稿", content_hash: "hash_b" }),
    ])
    expect(state.deliveries.map((d) => d.contentHash)).toEqual(["hash_a", "hash_b"])
    expect(state.deliveries[1]?.title).toBe("终稿")
  })

  it("copy-on-write：折叠不改入参 state 的 deliveries 引用与内容", () => {
    const before = applySessionEvent(
      createSessionStreamState(),
      makeEvent("delivery.created", {
        path: "out/a.md",
        title: "A",
        mime: "text/markdown",
        size: 1,
        content_hash: "hash_a",
      }),
    )
    const beforeDeliveries = before.deliveries
    const after = applySessionEvent(
      before,
      makeEvent("delivery.created", {
        path: "out/b.md",
        title: "B",
        mime: "text/markdown",
        size: 2,
        content_hash: "hash_b",
      }),
    )
    expect(before.deliveries).toBe(beforeDeliveries)
    expect(before.deliveries).toHaveLength(1)
    expect(after.deliveries).toHaveLength(2)
  })

  it("snapshot 水合的成果与重放事件同 hash：不重复入账", () => {
    const hydrated = stateFromSnapshot(
      makeSnapshot({ deliveries: [makeSnapshotDelivery({ content_hash: "hash_a" })] }),
    )
    const state = applySessionEvent(
      hydrated,
      makeEvent("delivery.created", {
        path: "out/report.md",
        title: "调研报告",
        mime: "text/markdown",
        size: 2048,
        content_hash: "hash_a",
      }),
    )
    expect(state.deliveries).toHaveLength(1)
  })
})

describe("边界矩阵", () => {
  it.each([
    ["空文本增量", { segment_id: "seg_1", delta: "" }],
    ["空段后续增量", { segment_id: "seg_1", delta: "next" }],
  ] as const)("%s 不崩溃且保持有序", (_label, payload) => {
    const state = applySessionEvent(
      createSessionStreamState(),
      makeEvent("message.delta", payload),
    )
    expect(state.messages).toHaveLength(1)
  })

  it("无配对 invoked 的 tool.returned 补录结果不丢事件", () => {
    const state = applySessionEvent(
      createSessionStreamState(),
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_x",
        name: "w",
        result: "late",
        is_error: false,
      }),
    )
    expect(toolStatusOf(state, "run_1", "tool_x")).toBe("done")
  })

  it("appendUserMessage 复位 runStatus/todos 且不进 seenEventIds", () => {
    let state = applySessionEvents(createSessionStreamState(), [
      makeEvent("todo.updated", { todos: [{ content: "x", status: "pending" }] }),
      makeEvent("run.failed", { code: "internal_error", error_kind: "agent", message: "boom" }),
    ])
    state = appendUserMessage(state, { id: "usr_1", content: "again" })
    expect(state.runStatus).toBe("idle")
    expect(state.todos).toEqual([])
    expect(state.seenEventIds.has("usr_1")).toBe(false)
    expect(state.messages.at(-1)).toMatchObject({ role: "user", runId: "usr_1" })
  })
})

describe("Schema 崩溃矩阵（契约入站防线）", () => {
  it.each([
    ["未知 kind", { kind: "text.delta", payload: { segment_id: "s", delta: "x" } }],
    ["缺必填 payload 字段", { kind: "message.delta", payload: { delta: "x" } }],
    ["注入未知字段", { kind: "message.delta", payload: { segment_id: "s", delta: "x", evil: 1 } }],
    ["seq 非整数", { kind: "message.delta", payload: { segment_id: "s", delta: "x" }, seq: 1.5 }],
    ["is_error 缺失", {
      kind: "tool.returned",
      payload: { segment_id: "s", tool_id: "t", name: "n", result: "r" },
    }],
    ["信封缺 run_id", { kind: "run.created", payload: { run_id: "r" }, run_id: undefined }],
    ["信封带旧 conversation_id", {
      kind: "message.delta",
      payload: { segment_id: "s", delta: "x" },
      conversation_id: "conv",
    }],
  ])("%s 被 parseSessionEvent 拒绝", (_label, overrides) => {
    const base = {
      kind: "message.delta",
      payload: { segment_id: "s", delta: "x" },
      event_id: "e1",
      seq: 1,
      session_id: "ses",
      run_id: "run",
      timestamp: "2026-07-02T00:00:00Z",
    }
    expect(() => parseSessionEvent({ ...base, ...overrides })).toThrow()
  })
})


describe("run.failed 错误三层语义", () => {
  it("失败码与原文进入状态，供 UI 按码呈现；完成态清空", () => {
    const s1 = applySessionEvents(createSessionStreamState(), [
      makeEvent("run.created", { run_id: "run_f" }, { run_id: "run_f", seq: 1 }),
      makeEvent(
        "run.failed",
        { code: "assembly_failed", error_kind: "ValueError", message: "unknown tools" },
        { run_id: "run_f", seq: 2 },
      ),
    ])
    expect(s1.runStatus).toBe("failed")
    expect(s1.runError).toEqual({ code: "assembly_failed", message: "unknown tools" })
    // 新一轮完成后失败态清空（不残留上一轮的失败卡文案）。
    const s2 = applySessionEvents(s1, [
      makeEvent("run.completed", { status: "completed", token_usage: null }, { run_id: "run_g", seq: 3 }),
    ])
    expect(s2.runError).toBeNull()
  })
})
