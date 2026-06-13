import { describe, expect, it } from "vitest"

import {
  appendUserMessage,
  applySessionEvent,
  buildThreadItems,
  computeActivityVersion,
  createSessionStreamState,
  type SessionStep,
  type SessionStreamState,
} from "@/application/session-stream/reducer"
import {
  parseStoredSessionState,
  serializeSessionState,
} from "@/application/session-stream/state-schema"
import { toSessionStreamEvent } from "@/infrastructure/transport-event-mapper"
import { parseTransportEvent } from "@/infrastructure/transport-event-schema"

function requireDomainEvent(
  input: Parameters<typeof parseTransportEvent>[0],
) {
  const mappedEvent = toSessionStreamEvent(parseTransportEvent(input))

  if (!mappedEvent) {
    throw new Error("Expected a domain event")
  }

  return mappedEvent
}

// 取某 run 的有序步骤（默认 run_01），断言时序模型最常用的视角。
function stepsOf(state: SessionStreamState, runId = "run_01"): SessionStep[] {
  return state.stepsByRun[runId] ?? []
}

function toolSteps(state: SessionStreamState, runId = "run_01") {
  return stepsOf(state, runId)
    .filter((step) => step.kind === "tool")
    .map((step) => (step.kind === "tool" ? step.tool : null))
    .filter((tool): tool is NonNullable<typeof tool> => tool !== null)
}

function subagentSteps(state: SessionStreamState, runId = "run_01") {
  return stepsOf(state, runId)
    .filter((step) => step.kind === "subagent")
    .map((step) => (step.kind === "subagent" ? step.subagent : null))
    .filter((sub): sub is NonNullable<typeof sub> => sub !== null)
}

function thinkingTextOf(state: SessionStreamState, runId = "run_01"): string {
  return stepsOf(state, runId)
    .filter((step) => step.kind === "thinking")
    .map((step) => (step.kind === "thinking" ? step.text : ""))
    .join("")
}

describe("applySessionEvent", () => {
  it("deduplicates repeated event ids", () => {
    const event = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_01",
      seq: 12,
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { segment_id: "msg_01", delta: "Hi", role: "assistant" },
    })

    const once = applySessionEvent(createSessionStreamState(), event)
    const twice = applySessionEvent(once, event)

    expect(twice.messages).toHaveLength(1)
    expect(twice.messages[0]?.content).toBe("Hi")
    expect(twice.seenEventIds).toEqual(new Set(["evt_01"]))
  })

  it("threads a strictly increasing seq through the ordered stream", () => {
    // 为什么重要：信封的一等 seq 承载真实发射序号；丢弃它就无法还原 thinking→tool→text 的时序。
    // 一段有序流（tool → message → tool → message）映射后 seq 必须严格递增。
    const events = [
      {
        event: "tool.invoked",
        event_id: "e1",
        seq: 1,
        payload: { segment_id: "m1", tool_id: "t1", name: "a", args: {} },
      },
      {
        event: "message.delta",
        event_id: "e2",
        seq: 2,
        payload: { segment_id: "m1", delta: "x", role: "assistant" as const },
      },
      {
        event: "tool.invoked",
        event_id: "e3",
        seq: 3,
        payload: { segment_id: "m1", tool_id: "t2", name: "b", args: {} },
      },
      {
        event: "message.delta",
        event_id: "e4",
        seq: 4,
        payload: { segment_id: "m2", delta: "y", role: "assistant" as const },
      },
    ].map((spec) =>
      requireDomainEvent({
        ...spec,
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_x",
        timestamp: "2026-05-28T12:00:00.000Z",
      }),
    )

    const seqs = events.map((event) => event.seq)
    expect(seqs).toEqual([1, 2, 3, 4])
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]).toBeGreaterThan(seqs[i - 1] as number)
    }
  })

  it("replays tool→text→tool→text as four ordered steps in order", () => {
    // 为什么重要：真实时序是 tool→text→tool→text；reducer 必须按 seq APPEND 成四个有序步骤，
    // 而非按 kind 归桶。文本步骤与工具步骤交错排列，顺序严格还原。
    const events = [
      requireDomainEvent({
        event: "tool.invoked",
        event_id: "e1",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 1,
        timestamp: "2026-05-28T12:00:00.000Z",
        payload: { segment_id: "m1", tool_id: "t1", name: "a", args: {} },
      }),
      requireDomainEvent({
        event: "message.delta",
        event_id: "e2",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 2,
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { segment_id: "m1", delta: "first", role: "assistant" },
      }),
      requireDomainEvent({
        event: "tool.invoked",
        event_id: "e3",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 3,
        timestamp: "2026-05-28T12:00:02.000Z",
        payload: { segment_id: "m2", tool_id: "t2", name: "b", args: {} },
      }),
      requireDomainEvent({
        event: "message.delta",
        event_id: "e4",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 4,
        timestamp: "2026-05-28T12:00:03.000Z",
        payload: { segment_id: "m2", delta: "second", role: "assistant" },
      }),
    ]
    const state = events.reduce(applySessionEvent, createSessionStreamState())

    const steps = stepsOf(state)
    expect(steps.map((step) => step.kind)).toEqual([
      "tool",
      "text",
      "tool",
      "text",
    ])
    expect(steps.map((step) => step.seq)).toEqual([1, 2, 3, 4])
  })

  it("updates the SAME tool step from running to done on its return (no reorder)", () => {
    // 为什么重要：tool.returned 必须就地把同一 tool step 由 running 翻 done，保持原位置，
    // 绝不新增一个步骤或重排（重排会谎报因果、引发回流）。
    const invoked = requireDomainEvent({
      event: "tool.invoked",
      event_id: "e1",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 1,
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { segment_id: "m1", tool_id: "t1", name: "get_weather", args: { city: "北京" } },
    })
    const text = requireDomainEvent({
      event: "message.delta",
      event_id: "e2",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 2,
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: { segment_id: "m1", delta: "结果", role: "assistant" },
    })
    const returned = requireDomainEvent({
      event: "tool.returned",
      event_id: "e3",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 3,
      timestamp: "2026-05-28T12:00:02.000Z",
      payload: { segment_id: "m1", tool_id: "t1", name: "get_weather", result: "北京: 晴", is_error: false },
    })

    let state = [invoked, text].reduce(applySessionEvent, createSessionStreamState())
    expect(stepsOf(state).map((s) => s.kind)).toEqual(["tool", "text"])
    expect(toolSteps(state)[0]).toMatchObject({ id: "t1", status: "running" })

    state = applySessionEvent(state, returned)
    // 位置不变（仍是 [tool, text]），同一步骤就地翻 done，不新增第三个步骤。
    expect(stepsOf(state).map((s) => s.kind)).toEqual(["tool", "text"])
    expect(toolSteps(state)).toHaveLength(1)
    expect(toolSteps(state)[0]).toMatchObject({
      id: "t1",
      result: "北京: 晴",
      status: "done",
    })
    // 成功态不得残留 errorText（is_error=false 路径只写 status/result）。
    expect(toolSteps(state)[0]).not.toHaveProperty("errorText")
  })

  it("maps a failed tool return (is_error=true) to status=error + errorText", () => {
    // 真实 tool-error 接通：is_error=true 的 tool.returned 把工具 step 翻成 error 态，
    // 并把错误原因放进 errorText（UI 显红、可展开看错误），而非默默标 done。
    const invoked = requireDomainEvent({
      event: "tool.invoked",
      event_id: "e1",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 1,
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { segment_id: "m1", tool_id: "t1", name: "fetch_url", args: { url: "x" } },
    })
    const failed = requireDomainEvent({
      event: "tool.returned",
      event_id: "e2",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 2,
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: {
        segment_id: "m1",
        tool_id: "t1",
        name: "fetch_url",
        result: "ValueError: connection refused",
        is_error: true,
      },
    })
    const state = [invoked, failed].reduce(applySessionEvent, createSessionStreamState())
    expect(toolSteps(state)[0]).toMatchObject({
      id: "t1",
      status: "error",
      errorText: "ValueError: connection refused",
    })
  })

  it("lets message.completed replace accumulated delta content", () => {
    const state = [
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_01",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 12,
        timestamp: "2026-05-28T12:00:00.000Z",
        payload: { segment_id: "msg_01", delta: "He", role: "assistant" },
      }),
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_02",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 13,
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { segment_id: "msg_01", delta: "llo", role: "assistant" },
      }),
      requireDomainEvent({
        event: "message.completed",
        event_id: "evt_03",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 14,
        timestamp: "2026-05-28T12:00:02.000Z",
        payload: { segment_id: "msg_01", role: "assistant", content: "Hello" },
      }),
    ].reduce(applySessionEvent, createSessionStreamState())

    expect(state.messages[0]?.content).toBe("Hello")
  })

  it("does not mutate previously returned state when a second delta arrives", () => {
    const firstDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_01",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 12,
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { segment_id: "msg_01", delta: "He", role: "assistant" },
    })
    const secondDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_02",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 13,
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: { segment_id: "msg_01", delta: "llo", role: "assistant" },
    })

    const firstState = applySessionEvent(createSessionStreamState(), firstDelta)
    const secondState = applySessionEvent(firstState, secondDelta)

    expect(firstState.messages[0]?.content).toBe("He")
    expect(secondState.messages[0]?.content).toBe("Hello")
    expect(firstState.messages[0]).not.toBe(secondState.messages[0])
  })

  it("dedups a replayed session-created without re-mutating state", () => {
    const sessionCreated = requireDomainEvent({
      event: "session.created",
      event_id: "evt_session",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 1,
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: {
        session_id: "ses_01",
        conversation_id: "conv_01",
        owner_id: "usr_01",
        title: "Warm launch",
      },
    })

    const once = applySessionEvent(createSessionStreamState(), sessionCreated)
    const twice = applySessionEvent(once, sessionCreated)

    expect(twice.seenEventIds).toEqual(new Set(["evt_session"]))
    expect(twice.messages).toEqual([])
    expect(twice.runStatus).toBe("idle")
  })

  it("dedups a message-delta sharing an eventId with session-created", () => {
    const sessionCreated = requireDomainEvent({
      event: "session.created",
      event_id: "evt_shared",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 1,
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: {
        session_id: "ses_01",
        conversation_id: "conv_01",
        owner_id: "usr_01",
        title: "Warm launch",
      },
    })
    const collidingDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_shared",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 2,
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: { segment_id: "msg_01", delta: "Hi", role: "assistant" },
    })

    const state = [sessionCreated, collidingDelta].reduce(
      applySessionEvent,
      createSessionStreamState(),
    )

    expect(state.seenEventIds).toEqual(new Set(["evt_shared"]))
    expect(state.messages).toEqual([])
  })

  it("keeps the role fixed at first delta for a segmentId (role integrity)", () => {
    const firstDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_01",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 12,
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { segment_id: "msg_01", delta: "He", role: "assistant" },
    })
    const driftingDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_02",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      seq: 13,
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: { segment_id: "msg_01", delta: "llo", role: "user" },
    })

    const state = [firstDelta, driftingDelta].reduce(
      applySessionEvent,
      createSessionStreamState(),
    )

    expect(state.messages).toHaveLength(1)
    expect(state.messages[0]?.role).toBe("assistant")
    expect(state.messages[0]?.content).toBe("Hello")
  })

  it("folds empty, oversized, and completed deltas without error (boundary matrix)", () => {
    const huge = "x".repeat(50_000)

    const state = [
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_empty",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 12,
        timestamp: "2026-05-28T12:00:00.000Z",
        payload: { segment_id: "msg_01", delta: "", role: "assistant" },
      }),
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_huge",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 13,
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { segment_id: "msg_01", delta: huge, role: "assistant" },
      }),
    ].reduce(applySessionEvent, createSessionStreamState())

    expect(state.messages[0]?.content).toBe(huge)

    const completed = applySessionEvent(
      state,
      requireDomainEvent({
        event: "message.completed",
        event_id: "evt_done",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 14,
        timestamp: "2026-05-28T12:00:02.000Z",
        payload: { segment_id: "msg_01", role: "assistant", content: "Hello" },
      }),
    )

    expect(completed.messages).toHaveLength(1)
    expect(completed.messages[0]?.content).toBe("Hello")
  })

  it("marks failed runs without duplicating terminal transitions", () => {
    const state = [
      requireDomainEvent({
        event: "run.failed",
        event_id: "evt_10",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 20,
        timestamp: "2026-05-28T12:00:10.000Z",
        payload: {
          run_id: "run_01",
          error_kind: "transport_error",
          message: "stream disconnected",
          retryable: true,
        },
      }),
      requireDomainEvent({
        event: "run.failed",
        event_id: "evt_10",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        seq: 20,
        timestamp: "2026-05-28T12:00:10.000Z",
        payload: {
          run_id: "run_01",
          error_kind: "transport_error",
          message: "stream disconnected",
          retryable: true,
        },
      }),
    ].reduce(applySessionEvent, createSessionStreamState())

    expect(state.runStatus).toBe("failed")
    expect(state.seenEventIds).toEqual(new Set(["evt_10"]))
  })
})

describe("appendUserMessage", () => {
  it("appends a local user message without touching the dedup table", () => {
    const next = appendUserMessage(createSessionStreamState(), {
      id: "local_1",
      content: "你好",
    })

    expect(next.messages).toEqual([
      { id: "local_1", role: "user", content: "你好", runId: "local_1" },
    ])
    expect(next.seenEventIds).toEqual(new Set())
  })

  it("does not mutate the previous state", () => {
    const before = createSessionStreamState()
    const after = appendUserMessage(before, { id: "local_1", content: "hi" })

    expect(before.messages).toHaveLength(0)
    expect(after.messages).toHaveLength(1)
    expect(after).not.toBe(before)
    expect(after.messages).not.toBe(before.messages)
  })

  it("keeps prior turns ordered ahead of the new user message", () => {
    const assistantTurn = applySessionEvent(createSessionStreamState(), {
      kind: "message-completed",
      eventId: "evt_a1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "msg_a1",
      role: "assistant",
      content: "第一轮回答",
    })

    const next = appendUserMessage(assistantTurn, {
      id: "local_2",
      content: "第二个问题",
    })

    expect(next.messages.map((m) => [m.role, m.content])).toEqual([
      ["assistant", "第一轮回答"],
      ["user", "第二个问题"],
    ])
  })

  it("survives a subsequent assistant run folded on top", () => {
    const withUser = appendUserMessage(createSessionStreamState(), {
      id: "local_1",
      content: "讲讲今天",
    })

    const afterReply = [
      {
        kind: "message-delta" as const,
        eventId: "evt_r1",
        seq: 1,
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_02",
        segmentId: "msg_r1",
        role: "assistant" as const,
        delta: "好的，",
      },
      {
        kind: "message-completed" as const,
        eventId: "evt_r2",
        seq: 2,
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_02",
        segmentId: "msg_r1",
        role: "assistant" as const,
        content: "好的，我们开始。",
      },
      {
        kind: "run-completed" as const,
        eventId: "evt_r3",
        seq: 3,
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_02",
      },
    ].reduce(applySessionEvent, withUser)

    expect(afterReply.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
    ])
    expect(afterReply.messages[1]?.content).toBe("好的，我们开始。")
    expect(afterReply.runStatus).toBe("completed")
  })

  it("resets todos + runStatus on a new user turn but keeps prior run steps", () => {
    let state = applySessionEvent(createSessionStreamState(), {
      kind: "message-completed",
      eventId: "evt_prev_msg",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m_prev",
      role: "assistant",
      content: "上一段",
    })
    state = applySessionEvent(state, {
      kind: "tool-invoked",
      eventId: "evt_tool_prev",
      seq: 2,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m_prev",
      toolId: "t_prev",
      name: "get_weather",
      args: { city: "北京" },
    })
    state = applySessionEvent(state, {
      kind: "todo-updated",
      eventId: "evt_t",
      seq: 3,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      todos: [{ content: "x", status: "completed" }],
    })
    expect(state.todos).toHaveLength(1)
    expect(toolSteps(state)).toHaveLength(1)

    state = appendUserMessage(state, { id: "u2", content: "下一轮" })

    // 新一轮：todo 整表清空、终态复位 idle；历史 run 的有序步骤完整保留。
    expect(state.todos).toEqual([])
    expect(state.runStatus).toBe("idle")
    expect(toolSteps(state)).toHaveLength(1)
    expect(state.messages.some((message) => message.content === "下一轮")).toBe(
      true,
    )
  })
})

describe("parseStoredSessionState", () => {
  function populatedState(): SessionStreamState {
    return [
      {
        kind: "message-completed" as const,
        eventId: "evt_p1",
        seq: 1,
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_01",
        segmentId: "msg_p1",
        role: "assistant" as const,
        content: "已恢复的回答",
      },
      {
        kind: "run-completed" as const,
        eventId: "evt_p2",
        seq: 2,
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_01",
      },
    ].reduce(applySessionEvent, appendUserMessage(createSessionStreamState(), {
      id: "local_p1",
      content: "恢复我",
    }))
  }

  it("round-trips a populated state through serialize -> parse unchanged", () => {
    const original = populatedState()
    const restored = parseStoredSessionState(
      JSON.parse(JSON.stringify(serializeSessionState(original))),
    )

    expect(restored).toEqual(original)
  })

  it("round-trips ordered steps (thinking/tool/subagent/text) unchanged", () => {
    // 为什么重要：有序步骤是新模型的核心持久化契约——写进去什么，刷新后读出来必须一字不差。
    let state = appendUserMessage(createSessionStreamState(), {
      id: "u1",
      content: "问",
    })
    state = applySessionEvent(state, {
      kind: "thinking-delta",
      eventId: "k1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      delta: "先想",
    })
    state = applySessionEvent(state, {
      kind: "tool-invoked",
      eventId: "ti",
      seq: 2,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      toolId: "t1",
      name: "get_weather",
      args: { city: "北京" },
    })
    state = applySessionEvent(state, {
      kind: "tool-returned",
      eventId: "tr",
      seq: 3,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      toolId: "t1",
      name: "get_weather",
      result: "晴",
      isError: false,
    })
    state = applySessionEvent(state, {
      kind: "message-completed",
      eventId: "c1",
      seq: 4,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      role: "assistant",
      content: "晴，适合出门。",
    })

    const restored = parseStoredSessionState(
      JSON.parse(JSON.stringify(serializeSessionState(state))),
    )
    expect(restored).toEqual(state)
    expect(restored?.stepsByRun["run_01"]?.map((s) => s.kind)).toEqual([
      "thinking",
      "tool",
      "text",
    ])
  })

  it.each([
    [
      "missing messages",
      { seenEventIds: [], runStatus: "idle" },
    ],
    [
      "extra unknown field (strict)",
      {
        seenEventIds: [],
        messages: [],
        runStatus: "idle",
        rogue: "drop me",
      },
    ],
    [
      "wrong runStatus value",
      { seenEventIds: [], messages: [], runStatus: "streaming" },
    ],
    [
      "message with invalid role",
      {
        seenEventIds: [],
        messages: [{ id: "m1", role: "system", content: "x", runId: "r1" }],
        runStatus: "idle",
      },
    ],
    [
      "non-array seenEventIds",
      { seenEventIds: "evt_01", messages: [], runStatus: "idle" },
    ],
    [
      "message missing content",
      {
        seenEventIds: [],
        messages: [{ id: "m1", role: "assistant" }],
        runStatus: "idle",
      },
    ],
    [
      "message with extra field (strict)",
      {
        seenEventIds: [],
        messages: [
          { id: "m1", role: "assistant", content: "x", runId: "r1", leaked: true },
        ],
        runStatus: "idle",
      },
    ],
    [
      "step with unknown kind",
      {
        seenEventIds: [],
        messages: [],
        runStatus: "idle",
        stepsByRun: { run_01: [{ kind: "mystery", seq: 1, segmentId: "m1" }] },
      },
    ],
  ])(
    "returns null for malformed persisted shape: %s",
    (_label, candidate) => {
      expect(parseStoredSessionState(candidate)).toBeNull()
    },
  )

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["array root", []],
    ["string root", "not an object"],
    ["number root", 0],
  ])(
    "returns null for non-object persisted root: %s",
    (_label, candidate) => {
      expect(parseStoredSessionState(candidate)).toBeNull()
    },
  )

  it("accepts a minimal empty state (the fresh-session baseline)", () => {
    expect(
      parseStoredSessionState(serializeSessionState(createSessionStreamState())),
    ).toEqual(createSessionStreamState())
  })

  it("restores a legacy persisted state without activity/runId fields", () => {
    // 向后兼容：旧版落盘没有 todos/stepsByRun，且 message 无 runId，必须补默认值而非判脏。
    const legacy = {
      seenEventIds: ["e1"],
      messages: [{ id: "a1", role: "assistant", content: "hi" }],
      runStatus: "completed",
    }
    const restored = parseStoredSessionState(legacy)
    expect(restored).not.toBeNull()
    expect(restored?.todos).toEqual([])
    expect(restored?.stepsByRun).toEqual({})
    expect(restored?.messages[0]?.runId).toBe("")
  })
})

describe("applySessionEvent activity families", () => {
  const base = {
    session_id: "ses_01",
    conversation_id: "conv_01",
    run_id: "run_01",
    timestamp: "2026-05-28T12:00:00.000Z",
  }

  it("todo.updated replaces the checklist with the latest list", () => {
    const first = requireDomainEvent({
      event: "todo.updated",
      event_id: "evt_t1",
      ...base,
      seq: 1,
      payload: {
        todos: [
          { content: "查天气", status: "in_progress" },
          { content: "作答", status: "pending" },
        ],
      },
    })
    const second = requireDomainEvent({
      event: "todo.updated",
      event_id: "evt_t2",
      ...base,
      seq: 2,
      payload: {
        todos: [
          { content: "查天气", status: "completed" },
          { content: "作答", status: "in_progress" },
        ],
      },
    })
    let state = applySessionEvent(createSessionStreamState(), first)
    expect(state.todos).toHaveLength(2)
    state = applySessionEvent(state, second)
    expect(state.todos).toEqual([
      { content: "查天气", status: "completed" },
      { content: "作答", status: "in_progress" },
    ])
  })

  it("tool.invoked then tool.returned becomes one ordered tool step on the run", () => {
    const invoked = requireDomainEvent({
      event: "tool.invoked",
      event_id: "evt_i",
      ...base,
      seq: 1,
      payload: {
        segment_id: "m1",
        tool_id: "t1",
        name: "get_weather",
        args: { city: "北京" },
      },
    })
    const returned = requireDomainEvent({
      event: "tool.returned",
      event_id: "evt_r",
      ...base,
      seq: 2,
      payload: {
        segment_id: "m1",
        tool_id: "t1",
        name: "get_weather",
        result: "北京: 晴",
        is_error: false,
      },
    })
    let state = applySessionEvent(createSessionStreamState(), invoked)
    expect(toolSteps(state)).toEqual([
      { id: "t1", name: "get_weather", args: { city: "北京" }, status: "running" },
    ])
    state = applySessionEvent(state, returned)
    expect(toolSteps(state)).toHaveLength(1)
    expect(toolSteps(state)[0]).toMatchObject({
      id: "t1",
      result: "北京: 晴",
      status: "done",
    })
  })

  it("interleaves tool then subagent in seq order on the same run", () => {
    let state = createSessionStreamState()
    state = applySessionEvent(state, {
      kind: "message-completed",
      eventId: "evt_m1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      role: "assistant",
      content: "第一段",
    })
    state = applySessionEvent(
      state,
      requireDomainEvent({
        event: "tool.invoked",
        event_id: "evt_tool_m1",
        ...base,
        seq: 3,
        payload: {
          segment_id: "m1",
          tool_id: "tool_1",
          name: "get_weather",
          args: { city: "北京" },
        },
      }),
    )
    state = applySessionEvent(
      state,
      requireDomainEvent({
        event: "subagent.started",
        event_id: "evt_sub_m2",
        ...base,
        seq: 4,
        payload: {
          segment_id: "m1",
          subagent_id: "sa_1",
          name: "researcher",
          description: "查资料",
          subagent_type: "researcher",
          source: "built-in",
        },
      }),
    )

    // 同一 run 的有序步骤：text(seq1) → tool(seq3) → subagent(seq4)。
    expect(stepsOf(state).map((s) => s.kind)).toEqual(["text", "tool", "subagent"])
    expect(toolSteps(state)).toHaveLength(1)
    expect(subagentSteps(state)).toHaveLength(1)
  })

  it("subagent lifecycle marks started then done in place", () => {
    const started = requireDomainEvent({
      event: "subagent.started",
      event_id: "evt_s1",
      ...base,
      seq: 1,
      payload: {
        segment_id: "m1",
        subagent_id: "sa1",
        name: "researcher",
        description: "查资料",
        subagent_type: "researcher",
        source: "built-in",
      },
    })
    const finished = requireDomainEvent({
      event: "subagent.finished",
      event_id: "evt_s2",
      ...base,
      seq: 2,
      payload: {
        segment_id: "m1",
        subagent_id: "sa1",
        name: "researcher",
        subagent_type: "researcher",
        source: "built-in",
      },
    })
    let state = applySessionEvent(createSessionStreamState(), started)
    expect(subagentSteps(state)[0]).toMatchObject({ id: "sa1", status: "running" })
    state = applySessionEvent(state, finished)
    expect(subagentSteps(state)[0]?.status).toBe("done")
  })

  it("subagent text attaches to the correct subagent step", () => {
    let state = applySessionEvent(
      createSessionStreamState(),
      requireDomainEvent({
        event: "subagent.started",
        event_id: "evt_s1",
        ...base,
        seq: 1,
        payload: {
          segment_id: "m1",
          subagent_id: "sa1",
          name: "researcher",
          description: "查资料",
          subagent_type: "researcher",
          source: "built-in",
        },
      }),
    )
    state = applySessionEvent(state, {
      kind: "subagent-text-completed",
      eventId: "evt_sub_text",
      seq: 2,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      subagentId: "sa1",
      text: "子智能体结论",
    })

    expect(subagentSteps(state)[0]).toMatchObject({
      id: "sa1",
      output: "子智能体结论",
    })
  })

  it("thinking.delta accumulates reasoning text in one ordered step", () => {
    const a = requireDomainEvent({
      event: "thinking.delta",
      event_id: "evt_k1",
      ...base,
      seq: 1,
      payload: { segment_id: "m1", delta: "先想" },
    })
    const b = requireDomainEvent({
      event: "thinking.delta",
      event_id: "evt_k2",
      ...base,
      seq: 2,
      payload: { segment_id: "m1", delta: "再想" },
    })
    let state = applySessionEvent(createSessionStreamState(), a)
    state = applySessionEvent(state, b)
    expect(thinkingTextOf(state)).toBe("先想再想")
    // 同一段 thinking 续写不新增步骤。
    expect(stepsOf(state).filter((s) => s.kind === "thinking")).toHaveLength(1)
  })

  it("computeActivityVersion grows as thinking/tool/subagent activity streams in", () => {
    const v0 = computeActivityVersion(createSessionStreamState())
    expect(v0).toBe(0)

    let state = applySessionEvent(createSessionStreamState(), {
      kind: "thinking-delta",
      eventId: "av-think-1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      delta: "先想想",
    })
    const vThinking = computeActivityVersion(state)
    expect(vThinking).toBeGreaterThan(v0)

    state = applySessionEvent(state, {
      kind: "thinking-delta",
      eventId: "av-think-2",
      seq: 2,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      delta: "再想想",
    })
    expect(computeActivityVersion(state)).toBeGreaterThan(vThinking)

    const vBeforeTool = computeActivityVersion(state)
    state = applySessionEvent(state, {
      kind: "tool-invoked",
      eventId: "av-tool",
      seq: 3,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      toolId: "t1",
      name: "get_weather",
      args: { city: "北京" },
    })
    expect(computeActivityVersion(state)).toBeGreaterThan(vBeforeTool)

    const vBeforeSub = computeActivityVersion(state)
    state = applySessionEvent(state, {
      kind: "subagent-started",
      eventId: "av-sub",
      seq: 4,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      subagentId: "sa1",
      name: "researcher",
      description: "查资料",
      subagentType: "researcher",
      source: "built-in",
    })
    expect(computeActivityVersion(state)).toBeGreaterThan(vBeforeSub)

    const vBeforeOutput = computeActivityVersion(state)
    state = applySessionEvent(state, {
      kind: "subagent-text-delta",
      eventId: "av-sub-text",
      seq: 5,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      subagentId: "sa1",
      text: "子智能体在写结论",
    })
    expect(computeActivityVersion(state)).toBeGreaterThan(vBeforeOutput)
  })

  it("computeActivityVersion is a pure derivation that does not depend on identity", () => {
    const a = applySessionEvent(createSessionStreamState(), {
      kind: "thinking-delta",
      eventId: "pa-1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      delta: "abc",
    })
    const b = applySessionEvent(createSessionStreamState(), {
      kind: "thinking-delta",
      eventId: "pb-1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      delta: "xyz",
    })
    expect(computeActivityVersion(a)).toBe(computeActivityVersion(b))
  })
})

describe("buildThreadItems grouping", () => {
  it("groups consecutive assistant messages of one run under a single turn", () => {
    // 为什么重要：多段 assistant 文本属于同一 run，必须归并到一轮（一个头像、一条脊），
    // 而不是每段各起一个 turn。用户消息在 turn 之上单独成项。
    let state = appendUserMessage(createSessionStreamState(), {
      id: "u1",
      content: "问",
    })
    state = applySessionEvent(state, {
      kind: "message-completed",
      eventId: "c1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      role: "assistant",
      content: "第一段",
    })
    state = applySessionEvent(state, {
      kind: "message-completed",
      eventId: "c2",
      seq: 2,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m2",
      role: "assistant",
      content: "第二段",
    })

    const items = buildThreadItems(state)
    expect(items.map((i) => i.kind)).toEqual(["user", "assistant-turn"])
    const turn = items[1]
    expect(turn?.kind === "assistant-turn" && turn.runId).toBe("run_01")
    expect(
      turn?.kind === "assistant-turn" && Object.keys(turn.messagesById),
    ).toEqual(["m1", "m2"])
  })

  it("splits two separate runs into two turns", () => {
    let state = appendUserMessage(createSessionStreamState(), {
      id: "u1",
      content: "一",
    })
    state = applySessionEvent(state, {
      kind: "message-completed",
      eventId: "c1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      role: "assistant",
      content: "答一",
    })
    state = appendUserMessage(state, { id: "u2", content: "二" })
    state = applySessionEvent(state, {
      kind: "message-completed",
      eventId: "c2",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_02",
      segmentId: "m2",
      role: "assistant",
      content: "答二",
    })

    const items = buildThreadItems(state)
    expect(items.map((i) => i.kind)).toEqual([
      "user",
      "assistant-turn",
      "user",
      "assistant-turn",
    ])
  })

  it("renders a process-only run with no text yet as a forming turn", () => {
    // 为什么重要：过程先到、正文未到（首 token 未到）的 run 仍要渲染这一轮，不塌成空白。
    const state = applySessionEvent(createSessionStreamState(), {
      kind: "thinking-delta",
      eventId: "k1",
      seq: 1,
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      segmentId: "m1",
      delta: "先想",
    })

    const items = buildThreadItems(state)
    expect(items).toHaveLength(1)
    const turn = items[0]
    expect(turn?.kind === "assistant-turn" && turn.steps[0]?.kind).toBe(
      "thinking",
    )
  })
})

