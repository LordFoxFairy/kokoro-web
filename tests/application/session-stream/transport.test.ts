import { afterEach, describe, expect, it, vi } from "vitest"

import {
  consumeLiveSession,
  type SessionStreamSnapshot,
} from "@/application/session-stream/transport"
import {
  appendUserMessage,
  createSessionStreamState,
  type SessionStreamState,
} from "@/application/session-stream/reducer"

// 从某 run 的有序步骤里抽出工具 / 子智能体 / 思考文本，供断言新模型。
function runSteps(state: SessionStreamState | undefined, runId: string) {
  return state?.stepsByRun[runId] ?? []
}

function subagentsOf(state: SessionStreamState | undefined, runId: string) {
  return runSteps(state, runId)
    .filter((step) => step.kind === "subagent")
    .map((step) => (step.kind === "subagent" ? step.subagent : null))
    .filter((s): s is NonNullable<typeof s> => s !== null)
}

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

let envelopeSeq = 0
const envelope = (
  event: string,
  eventId: string,
  payload: Record<string, unknown>,
) => ({
  event,
  event_id: eventId,
  seq: (envelopeSeq += 1),
  session_id: "ses_01",
  conversation_id: "conv_01",
  run_id: "run_01",
  timestamp: "2026-05-28T12:00:00.000Z",
  payload,
})

afterEach(() => {
  MockEventSource.instances = []
  envelopeSeq = 0
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

  it("registers the discarded transport listener and folds a large completed body", async () => {
    // run.created 须有监听器（有意丢弃而非漏听），且其注册不影响 assistant 轮次折叠；超大正文须完整落入。
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

    // 被丢弃的事件不得改动 state，也不得抛错。
    expect(() =>
      source?.emit(
        "run.created",
        envelope("run.created", "evt_run", {
          run_id: "run_01",
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
    expect(subagentsOf(final, "run_01")[0]).toMatchObject({
      id: "sa_1",
      output: "子智能体结论",
    })
  })
})
