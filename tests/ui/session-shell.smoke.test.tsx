// 壳层主路径冒烟：发送 → 流式过程 → HITL 批准 → 终态收束；刷新水合后审批卡直接可操作。
// （行为规格在 core/engine 层。）

import { act } from "react"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it } from "vitest"

import { addConversation, type ConversationStore } from "@/core/conversations"
import { createSessionEngine, type SessionEngine } from "@/engine/machine"
import { SessionShell } from "@/ui/shell/session-shell"

import {
  awaitingPayload,
  makeEvent,
  makePendingPause,
  makeSnapshot,
  resetFixtureSeq,
} from "../core/fixtures"
import { createFakeClient, createMemoryStorage, settle, type FakeClient } from "../engine/fakes"

let client: FakeClient
let engine: SessionEngine

function buildEngine(initial: ConversationStore | null = null) {
  client = createFakeClient()
  let idCounter = 0
  engine = createSessionEngine({
    client,
    storage: createMemoryStorage<ConversationStore>(initial),
    now: () => 1_000,
    createId: (prefix) => `${prefix}_${(idCounter += 1)}`,
  })
}

beforeEach(() => {
  resetFixtureSeq()
  window.localStorage.clear()
})

afterEach(() => {
  engine.dispose()
  cleanup()
})

it("主路径：发送 → 流式 → HITL 批准 → 完成收束", async () => {
  buildEngine()
  render(<SessionShell engine={engine} />)

  // 空首屏 hero 与就绪状态行。
  expect(screen.getByText("今天想做什么？")).toBeInTheDocument()
  expect(screen.getByText(/等你发出首条消息/)).toBeInTheDocument()

  // 发送：用户胶囊即时出现（不等回执），输入框清空并进入流式停用。
  fireEvent.change(screen.getByLabelText("对话输入"), {
    target: { value: "帮我写个文件" },
  })
  fireEvent.click(screen.getByLabelText("发送消息"))
  expect(screen.getAllByText("帮我写个文件").length).toBeGreaterThan(0)
  expect(screen.getByLabelText("对话输入")).toHaveValue("")
  await act(settle)
  expect(client.startCalls).toHaveLength(1)
  expect(screen.getByLabelText("对话输入")).toBeDisabled()
  expect(screen.getByLabelText("停止生成")).toBeInTheDocument()

  // 流式过程：思考 + 工具待批帧（待批强制展开，批准按钮必须可达）。
  await act(async () => {
    client.lastStream().emit([
      makeEvent("run.created", { run_id: "run_1" }),
      makeEvent("thinking.delta", { segment_id: "seg_1", delta: "先确认写入范围。" }),
      makeEvent("tool.invoked", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "write_file",
        args: { path: "/tmp/a" },
      }),
      makeEvent("tool.awaiting_approval", awaitingPayload("tool_1", ["tool_1"])),
    ])
    await settle()
  })
  expect(screen.getByText("write_file")).toBeInTheDocument()
  expect(screen.getByText("先确认写入范围。")).toBeInTheDocument()

  // HITL：点批准 → 单帧凑齐即发一条带 decision_id 的 run.resume。
  fireEvent.click(screen.getByRole("button", { name: "批准" }))
  await act(settle)
  expect(client.controlCalls).toHaveLength(1)
  expect(client.controlCalls[0]?.body).toMatchObject({ kind: "run.resume" })

  // 工具回流 + 正文增量 + 终态：markdown 正文可见，composer 复位可继续输入。
  await act(async () => {
    client.lastStream().emit([
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "write_file",
        result: "ok",
        is_error: false,
      }),
      makeEvent("message.delta", { segment_id: "seg_2", delta: "文件已" }),
      makeEvent("message.delta", { segment_id: "seg_2", delta: "写好。" }),
      makeEvent("message.completed", { segment_id: "seg_2", content: "文件已写好。" }),
      makeEvent("run.completed", { status: "completed" }),
    ])
    await settle()
  })

  expect(screen.getByText("文件已写好。")).toBeInTheDocument()
  expect(screen.getByLabelText("对话输入")).not.toBeDisabled()
  expect(screen.getByLabelText("发送消息")).toBeInTheDocument()
  // 会话进入侧栏「最近」列表（标题取首条用户消息）。
  expect(screen.getByLabelText("最近会话")).toBeInTheDocument()
  expect(screen.getByText(/已准备继续/)).toBeInTheDocument()
})

it("刷新场景：带 pending pause 的 snapshot 水合后审批卡直接可操作", async () => {
  buildEngine(addConversation(null, "conv_9", 500))
  client.nextSnapshot = () =>
    Promise.resolve(
      makeSnapshot({
        sessionId: "conv_9",
        title: "恢复的会话",
        messages: [
          {
            message_id: "msg_u",
            role: "user",
            content: "帮我写个文件",
            status: "completed",
            created_at: "2026-07-02T00:00:00Z",
          },
        ],
        activeRun: { run_id: "run_9", status: "waiting_input" },
        pendingPauses: [
          makePendingPause({ run_id: "run_9", tool_id: "tool_1", tool_name: "write_file" }),
        ],
        eventWatermark: 20,
      }),
    )
  // 引擎在构造时水合：重建一次以套用编程后的 snapshot。
  engine.dispose()
  engine = createSessionEngine({
    client,
    storage: createMemoryStorage<ConversationStore>(addConversation(null, "conv_9", 500)),
    now: () => 1_000,
  })
  render(<SessionShell engine={engine} />)
  await act(settle)

  // 水合出的历史消息与待批工具直接就位，批准按钮可点。
  expect(screen.getAllByText("帮我写个文件").length).toBeGreaterThan(0)
  expect(screen.getByText("write_file")).toBeInTheDocument()
  fireEvent.click(screen.getByRole("button", { name: "批准" }))
  await act(settle)
  expect(client.controlCalls).toHaveLength(1)
  expect(client.controlCalls[0]).toMatchObject({
    sessionId: "conv_9",
    runId: "run_9",
    body: { kind: "run.resume", decisions: [{ type: "approve", tool_id: "tool_1" }] },
  })
})

it("ask_user 待批帧渲染问答卡：问题=description、choices 可选、提交即 respond", async () => {
  buildEngine()
  render(<SessionShell engine={engine} />)
  fireEvent.change(screen.getByLabelText("对话输入"), { target: { value: "选个方案" } })
  fireEvent.click(screen.getByLabelText("发送消息"))
  await act(settle)
  await act(async () => {
    client.lastStream().emit([
      makeEvent("run.created", { run_id: "run_1" }),
      makeEvent(
        "tool.awaiting_approval",
        awaitingPayload("tool_1", ["tool_1"], {
          name: "ask_user",
          kind: "ask_user",
          description: "选择要导入的 skill",
          allowed_decisions: ["respond"],
          args: { question: "选择要导入的 skill", choices: ["skill-a", "skill-b"] },
        }),
      ),
    ])
    await settle()
  })

  // 问答卡：问题、choices、取消 run 入口；不渲染批准/拒绝按钮组。
  expect(screen.getByText("选择要导入的 skill")).toBeInTheDocument()
  expect(screen.queryByRole("button", { name: "批准" })).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "不回答，停止本轮" })).toBeInTheDocument()

  fireEvent.click(screen.getByRole("radio", { name: "skill-a" }))
  fireEvent.click(screen.getByRole("button", { name: "发送回复" }))
  await act(settle)
  expect(client.controlCalls).toHaveLength(1)
  expect(client.controlCalls[0]?.body).toMatchObject({
    kind: "run.resume",
    decisions: [{ type: "respond", tool_id: "tool_1", response: "skill-a" }],
  })
})
