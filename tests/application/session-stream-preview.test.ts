import { afterEach, describe, expect, it, vi } from "vitest"

import {
  buildSimulatedReplyEvents,
  consumeLiveSession,
  simulateAssistantReply,
  type SessionStreamSnapshot,
} from "@/application/session-stream-preview"
import {
  appendUserMessage,
  createSessionStreamState,
} from "@/application/session-stream-reducer"

type Listener = (event: MessageEvent) => void

class MockEventSource {
  static instances: MockEventSource[] = []

  url: string
  closed = false
  onerror: ((event: Event) => void) | null = null

  private listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }

  addEventListener(name: string, listener: Listener) {
    const bucket = this.listeners.get(name) ?? new Set<Listener>()
    bucket.add(listener)
    this.listeners.set(name, bucket)
  }

  removeEventListener(name: string, listener: Listener) {
    this.listeners.get(name)?.delete(listener)
  }

  close() {
    this.closed = true
  }

  listenerCount(name: string) {
    return this.listeners.get(name)?.size ?? 0
  }

  emit(name: string, payload: unknown) {
    const event = new MessageEvent(name, { data: JSON.stringify(payload) })

    for (const listener of this.listeners.get(name) ?? []) {
      listener(event)
    }
  }
}

const envelope = (
  event: string,
  eventId: string,
  payload: Record<string, unknown>,
) => ({
  event,
  event_id: eventId,
  session_id: "ses_01",
  conversation_id: "conv_01",
  run_id: "run_01",
  cursor: `cursor-${eventId}`,
  timestamp: "2026-05-28T12:00:00.000Z",
  payload,
})

afterEach(() => {
  MockEventSource.instances = []
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("consumeLiveSession", () => {
  it("folds a live AGUI sequence into the reducer and closes on run.completed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const snapshots: SessionStreamSnapshot[] = []

    const handle = await consumeLiveSession({
      input: "hello kokoro",
      baseUrl: "http://127.0.0.1:3001",
      onState: (snapshot) => {
        snapshots.push(snapshot)
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(requestUrl).toContain("/sessions/ses_01/runs")
    expect(requestUrl).toContain("input=hello+kokoro")
    expect(requestInit.method).toBe("POST")

    const source = MockEventSource.instances[0]
    expect(source).toBeDefined()

    source?.emit(
      "session.created",
      envelope("session.created", "evt_00", {
        session_id: "ses_01",
        conversation_id: "conv_01",
        owner_id: "usr_01",
        title: "Warm launch",
      }),
    )
    source?.emit(
      "run.created",
      envelope("run.created", "evt_00b", {
        run_id: "run_01",
      }),
    )
    source?.emit(
      "message.delta",
      envelope("message.delta", "evt_01", {
        message_id: "msg_01",
        delta: "Hello ",
        role: "assistant",
      }),
    )
    source?.emit(
      "message.delta",
      envelope("message.delta", "evt_02", {
        message_id: "msg_01",
        delta: "world",
        role: "assistant",
      }),
    )
    source?.emit(
      "message.completed",
      envelope("message.completed", "evt_03", {
        message_id: "msg_01",
        role: "assistant",
        content: "Hello world from live SSE.",
      }),
    )
    source?.emit(
      "run.completed",
      envelope("run.completed", "evt_04", {
        run_id: "run_01",
        status: "completed",
      }),
    )

    const final = snapshots.at(-1)
    expect(final).toBeDefined()
    expect(final?.runStatus).toBe("completed")
    expect(final?.messages).toHaveLength(1)
    expect(final?.messages[0]?.role).toBe("assistant")
    expect(final?.messages[0]?.content).toBe("Hello world from live SSE.")

    expect(source?.closed).toBe(true)

    handle.close()
  })

  it("includes the provided executionStyle in the live run request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 202 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const handle = await consumeLiveSession({
      input: "hello",
      baseUrl: "http://127.0.0.1:3001",
      executionStyle: "thinking",
      onState: () => {},
    } as unknown as Parameters<typeof consumeLiveSession>[0])

    const [requestUrl] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(requestUrl).toContain("execution_style=thinking")

    handle.close()
  })

  it("ignores malformed envelopes without crashing the stream", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    )
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const snapshots: SessionStreamSnapshot[] = []
    await consumeLiveSession({
      input: "hello",
      baseUrl: "http://127.0.0.1:3001",
      onState: (snapshot) => snapshots.push(snapshot),
    })

    const source = MockEventSource.instances[0]

    // Unknown event family + missing required fields must be rejected, not throw.
    expect(() =>
      source?.emit("message.delta", {
        event: "message.delta",
        event_id: "evt_bad",
        payload: { delta: "oops" },
      }),
    ).not.toThrow()

    source?.emit(
      "message.completed",
      envelope("message.completed", "evt_ok", {
        message_id: "msg_01",
        role: "assistant",
        content: "Recovered.",
      }),
    )

    const final = snapshots.at(-1)
    expect(final?.messages).toHaveLength(1)
    expect(final?.messages[0]?.content).toBe("Recovered.")
  })

  it("keeps the stream convergent when run.created arrives before message events", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    )
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const snapshots: SessionStreamSnapshot[] = []
    await consumeLiveSession({
      input: "hello",
      baseUrl: "http://127.0.0.1:3001",
      onState: (snapshot) => snapshots.push(snapshot),
    })

    const source = MockEventSource.instances[0]
    expect(source?.listenerCount("run.created")).toBe(1)

    source?.emit(
      "run.created",
      envelope("run.created", "evt_run_created", {
        run_id: "run_01",
      }),
    )
    source?.emit(
      "message.completed",
      envelope("message.completed", "evt_msg", {
        message_id: "msg_01",
        role: "assistant",
        content: "Recovered after run.created.",
      }),
    )
    source?.emit(
      "run.completed",
      envelope("run.completed", "evt_done", {
        run_id: "run_01",
        status: "completed",
      }),
    )

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0]?.messages).toHaveLength(1)
    expect(snapshots[0]?.messages[0]?.content).toBe("Recovered after run.created.")
    expect(snapshots[1]?.runStatus).toBe("completed")
    expect(source?.closed).toBe(true)
  })

  it("closes the stream on run.failed and surfaces a failed status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    )
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const snapshots: SessionStreamSnapshot[] = []
    await consumeLiveSession({
      input: "hello",
      baseUrl: "http://127.0.0.1:3001",
      onState: (snapshot) => snapshots.push(snapshot),
    })

    const source = MockEventSource.instances[0]
    source?.emit(
      "run.failed",
      envelope("run.failed", "evt_fail", {
        run_id: "run_01",
        error_kind: "agent_error",
        message: "boom",
      }),
    )

    expect(snapshots.at(-1)?.runStatus).toBe("failed")
    expect(source?.closed).toBe(true)
  })

  it("folds a new run on top of a provided initialState (multi-turn thread)", async () => {
    // 多轮：本轮 run 的 assistant 事件必须折在已有 thread（含上一轮+用户气泡）之上，
    // 而不是从空状态重来，否则刷新/换轮会丢历史。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    )
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const initialState = appendUserMessage(createSessionStreamState(), {
      id: "local_user_1",
      content: "继续",
    })

    const snapshots: SessionStreamSnapshot[] = []
    const settled: boolean[] = []
    await consumeLiveSession({
      input: "继续",
      baseUrl: "http://127.0.0.1:3001",
      initialState,
      onState: (snapshot) => snapshots.push(snapshot),
      onSettled: () => settled.push(true),
    })

    const source = MockEventSource.instances[0]
    source?.emit(
      "message.completed",
      envelope("message.completed", "evt_reply", {
        message_id: "msg_turn2",
        role: "assistant",
        content: "第二轮回答。",
      }),
    )
    source?.emit(
      "run.completed",
      envelope("run.completed", "evt_done2", {
        run_id: "run_01",
        status: "completed",
      }),
    )

    const final = snapshots.at(-1)
    expect(final?.messages.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(final?.messages[0]?.content).toBe("继续")
    expect(final?.messages[1]?.content).toBe("第二轮回答。")
    expect(settled).toEqual([true])
  })

  it("registers the discarded transport listeners and folds a large completed body", async () => {
    // artifact.available / permission.required 必须有监听器（有意丢弃而非漏听），
    // 且它们的注册不能影响 assistant 轮次的折叠；超大正文须完整落入。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    )
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const snapshots: SessionStreamSnapshot[] = []
    await consumeLiveSession({
      input: "hello",
      baseUrl: "http://127.0.0.1:3001",
      onState: (snapshot) => snapshots.push(snapshot),
    })

    const source = MockEventSource.instances[0]
    expect(source?.listenerCount("artifact.available")).toBe(1)
    expect(source?.listenerCount("permission.required")).toBe(1)

    // 被丢弃的事件不得改动 state，也不得抛错。
    expect(() =>
      source?.emit(
        "artifact.available",
        envelope("artifact.available", "evt_art", {
          artifact_id: "art_01",
          artifact_kind: "doc",
          title: "Spec",
        }),
      ),
    ).not.toThrow()
    expect(snapshots).toHaveLength(0)

    const hugeBody = "答".repeat(50_000)
    source?.emit(
      "message.completed",
      envelope("message.completed", "evt_big", {
        message_id: "msg_big",
        role: "assistant",
        content: hugeBody,
      }),
    )
    source?.emit(
      "run.completed",
      envelope("run.completed", "evt_done_big", {
        run_id: "run_01",
        status: "completed",
      }),
    )

    const final = snapshots.at(-1)
    expect(final?.messages).toHaveLength(1)
    expect(final?.messages[0]?.role).toBe("assistant")
    expect(final?.messages[0]?.content).toBe(hugeBody)
    expect(final?.runStatus).toBe("completed")
  })

  it("stays alive on transient transport errors via onerror", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    )
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    let recoverableCalls = 0
    await consumeLiveSession({
      input: "hello",
      baseUrl: "http://127.0.0.1:3001",
      onState: () => {},
      onError: () => {
        recoverableCalls += 1
      },
    })

    const source = MockEventSource.instances[0]
    expect(() => source?.onerror?.(new Event("error"))).not.toThrow()
    expect(recoverableCalls).toBe(1)
    expect(source?.closed).toBe(false)
  })

  it("folds subagent internal text into the subagent output field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 202 })),
    )
    vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource)

    const snapshots: SessionStreamSnapshot[] = []
    await consumeLiveSession({
      input: "hello",
      baseUrl: "http://127.0.0.1:3001",
      onState: (snapshot) => snapshots.push(snapshot),
    })

    const source = MockEventSource.instances[0]
    expect(source?.listenerCount("subagent.text.delta")).toBe(1)
    expect(source?.listenerCount("subagent.text.completed")).toBe(1)
    source?.emit(
      "subagent.started",
      envelope("subagent.started", "evt_sub_1", {
        message_id: "msg_01",
        subagent_id: "sa_1",
        name: "researcher",
        description: "查资料",
        subagent_type: "researcher",
        source: "built-in",
      }),
    )
    source?.emit(
      "subagent.text.delta",
      envelope("subagent.text.delta", "evt_sub_2", {
        message_id: "msg_01",
        subagent_id: "sa_1",
        text: "子智能体",
      }),
    )
    source?.emit(
      "subagent.text.completed",
      envelope("subagent.text.completed", "evt_sub_3", {
        message_id: "msg_01",
        subagent_id: "sa_1",
        text: "子智能体结论",
      }),
    )

    const final = snapshots.at(-1)
    expect(final?.activityByMessageId["msg_01"]?.subagents[0]).toMatchObject({
      id: "sa_1",
      output: "子智能体结论",
    })
  })
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
    expect(final?.activityByMessageId["msg_th"]?.thinking.length).toBeGreaterThan(0)
    expect(final?.activityByMessageId["msg_th"]?.toolCalls.length).toBeGreaterThan(0)
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
    expect(final?.activityByMessageId["msg_fa"]?.thinking ?? "").toBe("")
    expect(final?.activityByMessageId["msg_fa"]?.toolCalls ?? []).toHaveLength(0)
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
