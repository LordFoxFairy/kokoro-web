import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildSimulatedReplyEvents,
  simulateAssistantReply,
} from "@/application/session-stream-simulator"
import { type SessionStreamSnapshot } from "@/application/session-stream-transport"
import {
  appendUserMessage,
  createSessionStreamState,
  type SessionStreamState,
} from "@/application/session-stream-reducer"

// 从某 run 的有序步骤里抽出工具 / 思考文本，供断言新模型。
function runSteps(state: SessionStreamState | undefined, runId: string) {
  return state?.stepsByRun[runId] ?? []
}

function toolsOf(state: SessionStreamState | undefined, runId: string) {
  return runSteps(state, runId)
    .filter((step) => step.kind === "tool")
    .map((step) => (step.kind === "tool" ? step.tool : null))
    .filter((t): t is NonNullable<typeof t> => t !== null)
}

function thinkingOf(state: SessionStreamState | undefined, runId: string) {
  return runSteps(state, runId)
    .filter((step) => step.kind === "thinking")
    .map((step) => (step.kind === "thinking" ? step.text : ""))
    .join("")
}

afterEach(() => {
  vi.useRealTimers()
})

describe("buildSimulatedReplyEvents", () => {
  it("is deterministic and terminates with run-completed", () => {
    const ids = { runId: "run_x", messageId: "msg_x" }
    const first = buildSimulatedReplyEvents("讲讲今天", ids)
    const second = buildSimulatedReplyEvents("讲讲今天", ids)

    expect(first).toEqual(second)
    expect(first.at(-1)?.kind).toBe("run-completed")

    const completed = first.find((event) => event.kind === "message-completed")
    expect(completed).toBeDefined()
    // 所有增量必须归属同一条 assistant 消息，才能正确归并成一段流式正文。
    const deltas = first.filter((event) => event.kind === "message-delta")
    expect(deltas.length).toBeGreaterThan(0)
    expect(deltas.every((event) => event.messageId === "msg_x")).toBe(true)
  })

  it("lightly echoes the user input so the reply is grounded", () => {
    const events = buildSimulatedReplyEvents("买杯咖啡", {
      runId: "run_y",
      messageId: "msg_y",
    })
    const completed = events.find((event) => event.kind === "message-completed")

    expect(completed?.kind === "message-completed" && completed.content).toContain(
      "买杯咖啡",
    )
  })

  it("fast mode emits only message deltas + completed, no thinking/tools/todos", () => {
    const events = buildSimulatedReplyEvents(
      "今天天气怎么样",
      { runId: "run_f", messageId: "msg_f" },
      "fast",
    )

    expect(events.some((e) => e.kind === "thinking-delta")).toBe(false)
    expect(events.some((e) => e.kind === "tool-invoked")).toBe(false)
    expect(events.some((e) => e.kind === "tool-returned")).toBe(false)
    expect(events.some((e) => e.kind === "todo-updated")).toBe(false)

    const kinds = new Set(events.map((e) => e.kind))
    expect(kinds).toEqual(
      new Set(["message-delta", "message-completed", "run-completed"]),
    )
    expect(events.at(-1)?.kind).toBe("run-completed")
  })

  it("thinking mode emits thinking + tool pair + todo BEFORE message-completed", () => {
    const events = buildSimulatedReplyEvents(
      "今天天气怎么样",
      { runId: "run_t", messageId: "msg_t" },
      "thinking",
    )

    const completedIndex = events.findIndex(
      (e) => e.kind === "message-completed",
    )
    expect(completedIndex).toBeGreaterThan(0)

    const before = events.slice(0, completedIndex)
    expect(before.some((e) => e.kind === "thinking-delta")).toBe(true)
    expect(before.some((e) => e.kind === "tool-invoked")).toBe(true)
    expect(before.some((e) => e.kind === "tool-returned")).toBe(true)
    expect(before.some((e) => e.kind === "todo-updated")).toBe(true)

    // tool-invoked must precede its tool-returned and share the same toolId.
    const invoked = events.find((e) => e.kind === "tool-invoked")
    const returned = events.find((e) => e.kind === "tool-returned")
    expect(invoked?.kind === "tool-invoked" && invoked.toolId).toBe(
      returned?.kind === "tool-returned" && returned.toolId,
    )
    expect(events.indexOf(invoked!)).toBeLessThan(events.indexOf(returned!))

    // todo carries exactly two steps.
    const todo = events.find((e) => e.kind === "todo-updated")
    expect(todo?.kind === "todo-updated" && todo.todos).toHaveLength(2)

    // thinking deltas + message deltas all carry the same messageId as the reply.
    const thinkingDeltas = events.filter((e) => e.kind === "thinking-delta")
    expect(thinkingDeltas.length).toBeGreaterThan(0)
    expect(
      thinkingDeltas.every(
        (e) => e.kind === "thinking-delta" && e.messageId === "msg_t",
      ),
    ).toBe(true)

    expect(events.at(-1)?.kind).toBe("run-completed")
  })

  it("thinking mode is deterministic (no randomness / wall clock)", () => {
    const ids = { runId: "run_d", messageId: "msg_d" }
    const first = buildSimulatedReplyEvents("讲讲今天", ids, "thinking")
    const second = buildSimulatedReplyEvents("讲讲今天", ids, "thinking")

    expect(first).toEqual(second)
  })

  it("chunks latin text on whole words, not rigid 2-char slices", () => {
    const events = buildSimulatedReplyEvents(
      "please tell me about today weather",
      { runId: "run_w", messageId: "msg_w" },
      "fast",
    )
    const deltas = events
      .filter((e) => e.kind === "message-delta")
      .map((e) => (e.kind === "message-delta" ? e.delta : ""))

    const reassembled = deltas.join("")
    // Whole words survive intact in the echoed reply.
    expect(reassembled).toContain("please")
    expect(reassembled).toContain("weather")
    // No latin delta may be a mid-word interior slice: every run of latin
    // letters inside a delta must be a complete word, i.e. flanked in the
    // reassembled text by a non-letter (or string edge) on both sides.
    let cursor = 0
    for (const delta of deltas) {
      const trimmed = delta.trim()
      if (/^[a-z]+$/i.test(trimmed)) {
        const start = reassembled.indexOf(trimmed, cursor)
        expect(start).toBeGreaterThanOrEqual(0)
        const before = reassembled[start - 1] ?? ""
        const after = reassembled[start + trimmed.length] ?? ""
        expect(/[a-z]/i.test(before)).toBe(false)
        expect(/[a-z]/i.test(after)).toBe(false)
      }
      cursor += delta.length
    }
  })
})

describe("simulateAssistantReply", () => {
  it("streams a reply on top of initialState to completion", () => {
    vi.useFakeTimers()

    const initialState = appendUserMessage(createSessionStreamState(), {
      id: "local_user_1",
      content: "你好",
    })

    const snapshots: SessionStreamSnapshot[] = []
    let settledCount = 0

    simulateAssistantReply({
      input: "你好",
      initialState,
      ids: { runId: "run_sim", messageId: "msg_sim" },
      stepMs: 1,
      onState: (snapshot) => snapshots.push(snapshot),
      onSettled: () => {
        settledCount += 1
      },
    })

    // 首个增量同步出现：用户气泡 + 正在成形的 assistant 气泡。
    expect(snapshots[0]?.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ])

    vi.runAllTimers()

    const final = snapshots.at(-1)
    expect(final?.messages).toHaveLength(2)
    expect(final?.messages[0]?.content).toBe("你好")
    expect(final?.messages[1]?.content).toContain("你好")
    expect(final?.runStatus).toBe("completed")
    expect(settledCount).toBe(1)
  })

  it("threads thinking executionStyle into the simulated stream", () => {
    vi.useFakeTimers()

    const snapshots: SessionStreamSnapshot[] = []
    simulateAssistantReply({
      input: "今天天气",
      ids: { runId: "run_th", messageId: "msg_th" },
      executionStyle: "thinking",
      stepMs: 1,
      onState: (snapshot) => snapshots.push(snapshot),
    })

    vi.runAllTimers()

    const final = snapshots.at(-1)
    // Thinking mode surfaces reasoning, a tool call, and a todo checklist.
    expect(thinkingOf(final, "run_th").length).toBeGreaterThan(0)
    expect(toolsOf(final, "run_th").length).toBeGreaterThan(0)
    expect(final?.todos).toHaveLength(2)
    expect(final?.runStatus).toBe("completed")
  })

  it("fast executionStyle skips thinking/tools/todos entirely", () => {
    vi.useFakeTimers()

    const snapshots: SessionStreamSnapshot[] = []
    simulateAssistantReply({
      input: "今天天气",
      ids: { runId: "run_fa", messageId: "msg_fa" },
      executionStyle: "fast",
      stepMs: 1,
      onState: (snapshot) => snapshots.push(snapshot),
    })

    vi.runAllTimers()

    const final = snapshots.at(-1)
    expect(thinkingOf(final, "run_fa")).toBe("")
    expect(toolsOf(final, "run_fa")).toHaveLength(0)
    expect(final?.todos).toHaveLength(0)
    expect(final?.runStatus).toBe("completed")
  })

  it("stops streaming when closed early", () => {
    vi.useFakeTimers()

    const snapshots: SessionStreamSnapshot[] = []
    const handle = simulateAssistantReply({
      input: "停",
      ids: { runId: "run_stop", messageId: "msg_stop" },
      stepMs: 1,
      onState: (snapshot) => snapshots.push(snapshot),
    })

    const countAfterFirst = snapshots.length
    handle.close()
    vi.runAllTimers()

    // 关闭后不得再有新的状态推送，避免卸载后 setState 泄漏。
    expect(snapshots.length).toBe(countAfterFirst)
  })
})
