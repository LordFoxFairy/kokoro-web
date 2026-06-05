import { describe, expect, it } from "vitest"

import {
  appendUserMessage,
  applySessionEvent,
  createSessionStreamState,
  parseStoredSessionState,
  type SessionStreamState,
} from "@/application/session-stream-reducer"
import {
  parseSessionEvent,
  toSessionStreamEvent,
} from "@/infrastructure/protocol/session-event"

function requireDomainEvent(
  input: Parameters<typeof parseSessionEvent>[0],
) {
  const mappedEvent = toSessionStreamEvent(parseSessionEvent(input))

  if (!mappedEvent) {
    throw new Error("Expected a domain event")
  }

  return mappedEvent
}

describe("applySessionEvent", () => {
  it("deduplicates repeated event ids", () => {
    const event = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_01",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000012",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { message_id: "msg_01", delta: "Hi", role: "assistant" },
    })

    const once = applySessionEvent(createSessionStreamState(), event)
    const twice = applySessionEvent(once, event)

    expect(twice.messages).toHaveLength(1)
    expect(twice.messages[0]?.content).toBe("Hi")
    expect(twice.seenEventIds).toEqual(["evt_01"])
  })

  it("lets message.completed replace accumulated delta content", () => {
    const state = [
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_01",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000012",
        timestamp: "2026-05-28T12:00:00.000Z",
        payload: { message_id: "msg_01", delta: "He", role: "assistant" },
      }),
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_02",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000013",
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { message_id: "msg_01", delta: "llo", role: "assistant" },
      }),
      requireDomainEvent({
        event: "message.completed",
        event_id: "evt_03",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000014",
        timestamp: "2026-05-28T12:00:02.000Z",
        payload: { message_id: "msg_01", role: "assistant", content: "Hello" },
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
      cursor: "1748428800-000012",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { message_id: "msg_01", delta: "He", role: "assistant" },
    })
    const secondDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_02",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000013",
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: { message_id: "msg_01", delta: "llo", role: "assistant" },
    })

    const firstState = applySessionEvent(createSessionStreamState(), firstDelta)
    const secondState = applySessionEvent(firstState, secondDelta)

    expect(firstState.messages[0]?.content).toBe("He")
    expect(secondState.messages[0]?.content).toBe("Hello")
    expect(firstState.messages[0]).not.toBe(secondState.messages[0])
  })

  it("dedups a replayed session-created without re-mutating state", () => {
    // session-created 携带的元数据不进入 thread；重复重放只能记一次 eventId，
    // 不得二次改动 messages / runStatus。删除显式 handler 会让本断言失败。
    const sessionCreated = requireDomainEvent({
      event: "session.created",
      event_id: "evt_session",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000001",
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

    expect(twice.seenEventIds).toEqual(["evt_session"])
    expect(twice.messages).toEqual([])
    expect(twice.runStatus).toBe("idle")
  })

  it("dedups a message-delta sharing an eventId with session-created", () => {
    // 边界：不同 kind 复用同一 eventId 时，去重以 eventId 为唯一键，
    // 第二个事件被整体丢弃，绝不偷偷追加一条消息。
    const sessionCreated = requireDomainEvent({
      event: "session.created",
      event_id: "evt_shared",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000001",
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
      cursor: "1748428800-000002",
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: { message_id: "msg_01", delta: "Hi", role: "assistant" },
    })

    const state = [sessionCreated, collidingDelta].reduce(
      applySessionEvent,
      createSessionStreamState(),
    )

    expect(state.seenEventIds).toEqual(["evt_shared"])
    expect(state.messages).toEqual([])
  })

  it("keeps the role fixed at first delta for a messageId (role integrity)", () => {
    // 同一 messageId 后续增量误报了不同 role，正文必须仍并入首个 role 的气泡，
    // 绝不能拆出第二条用户气泡或污染原气泡的 role。
    const firstDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_01",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000012",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { message_id: "msg_01", delta: "He", role: "assistant" },
    })
    const driftingDelta = requireDomainEvent({
      event: "message.delta",
      event_id: "evt_02",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000013",
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: { message_id: "msg_01", delta: "llo", role: "user" },
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
    // 边界矩阵：空增量不应破坏并归，超大单条增量必须完整落入，
    // message-completed 必须精确覆盖累计增量（防 replay 残句）。
    const huge = "x".repeat(50_000)

    const state = [
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_empty",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000012",
        timestamp: "2026-05-28T12:00:00.000Z",
        payload: { message_id: "msg_01", delta: "", role: "assistant" },
      }),
      requireDomainEvent({
        event: "message.delta",
        event_id: "evt_huge",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000013",
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { message_id: "msg_01", delta: huge, role: "assistant" },
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
        cursor: "1748428800-000014",
        timestamp: "2026-05-28T12:00:02.000Z",
        payload: { message_id: "msg_01", role: "assistant", content: "Hello" },
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
        cursor: "1748428800-000020",
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
        cursor: "1748428800-000020",
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
    expect(state.seenEventIds).toEqual(["evt_10"])
  })
})

describe("appendUserMessage", () => {
  it("appends a local user message without touching the dedup table", () => {
    // 用户消息是本地的、不会被服务端 replay，所以不应进入 seenEventIds。
    const next = appendUserMessage(createSessionStreamState(), {
      id: "local_1",
      content: "你好",
    })

    expect(next.messages).toEqual([
      { id: "local_1", role: "user", content: "你好" },
    ])
    expect(next.seenEventIds).toEqual([])
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
    // 多轮对话：用户气泡必须排在历史消息之后，保证时间线顺序稳定。
    const assistantTurn = applySessionEvent(createSessionStreamState(), {
      kind: "message-completed",
      eventId: "evt_a1",
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      messageId: "msg_a1",
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
    // 追加用户消息后再折叠新一轮 assistant 流，用户气泡不能丢失。
    const withUser = appendUserMessage(createSessionStreamState(), {
      id: "local_1",
      content: "讲讲今天",
    })

    const afterReply = [
      {
        kind: "message-delta" as const,
        eventId: "evt_r1",
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_02",
        messageId: "msg_r1",
        role: "assistant" as const,
        delta: "好的，",
      },
      {
        kind: "message-completed" as const,
        eventId: "evt_r2",
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_02",
        messageId: "msg_r1",
        role: "assistant" as const,
        content: "好的，我们开始。",
      },
      {
        kind: "run-completed" as const,
        eventId: "evt_r3",
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
})

describe("parseStoredSessionState", () => {
  // 一条有正文的真实快照：刷新恢复必须 1:1 还原会话线，不能丢消息或改 runStatus。
  function populatedState(): SessionStreamState {
    return [
      {
        kind: "message-completed" as const,
        eventId: "evt_p1",
        sessionId: "ses_01",
        conversationId: "conv_01",
        runId: "run_01",
        messageId: "msg_p1",
        role: "assistant" as const,
        content: "已恢复的回答",
      },
      {
        kind: "run-completed" as const,
        eventId: "evt_p2",
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
    // 为什么重要：持久化的契约是「写进去什么，刷新后读出来就是什么」，
    // 任何序列化/解析的有损都会让用户的历史对话在刷新后悄悄变形。
    const original = populatedState()
    const restored = parseStoredSessionState(
      JSON.parse(JSON.stringify(original)),
    )

    expect(restored).toEqual(original)
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
        messages: [{ id: "m1", role: "system", content: "x" }],
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
          { id: "m1", role: "assistant", content: "x", leaked: true },
        ],
        runStatus: "idle",
      },
    ],
  ])(
    "returns null for malformed persisted shape: %s",
    (_label, candidate) => {
      // 为什么重要：localStorage 是不可信输入（手改/旧版本/被注入），
      // 任何形状漂移都必须降级为 null（回空首屏），绝不能把脏数据塞进 reducer。
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
      // JSON.parse 也可能产出非对象根（如裸数组/字符串/数字），同样必须安全降级。
      expect(parseStoredSessionState(candidate)).toBeNull()
    },
  )

  it("accepts a minimal empty state (the fresh-session baseline)", () => {
    // 空态本身是合法的持久化基线：刚开新对话落盘的就是它，恢复不应把它判脏。
    expect(parseStoredSessionState(createSessionStreamState())).toEqual(
      createSessionStreamState(),
    )
  })

  it("restores a legacy persisted state without activity fields", () => {
    // 向后兼容：旧版落盘没有 todos/toolCalls/subagents/thinking，必须补默认值而非判脏。
    const legacy = {
      seenEventIds: ["e1"],
      messages: [{ id: "a1", role: "assistant", content: "hi" }],
      runStatus: "completed",
    }
    const restored = parseStoredSessionState(legacy)
    expect(restored).not.toBeNull()
    expect(restored?.todos).toEqual([])
    expect(restored?.toolCalls).toEqual([])
    expect(restored?.subagents).toEqual([])
    expect(restored?.thinking).toBe("")
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
      cursor: "run_01:0001",
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
      cursor: "run_01:0002",
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
    // 整表替换：只保留最新一版，不堆积。
    expect(state.todos).toEqual([
      { content: "查天气", status: "completed" },
      { content: "作答", status: "in_progress" },
    ])
  })

  it("tool.invoked then tool.returned builds one tool call with its result", () => {
    const invoked = requireDomainEvent({
      event: "tool.invoked",
      event_id: "evt_i",
      ...base,
      cursor: "run_01:0001",
      payload: { tool_id: "t1", name: "get_weather", args: { city: "北京" } },
    })
    const returned = requireDomainEvent({
      event: "tool.returned",
      event_id: "evt_r",
      ...base,
      cursor: "run_01:0002",
      payload: { tool_id: "t1", name: "get_weather", result: "北京: 晴" },
    })
    let state = applySessionEvent(createSessionStreamState(), invoked)
    expect(state.toolCalls).toEqual([
      { id: "t1", name: "get_weather", args: { city: "北京" }, status: "running" },
    ])
    state = applySessionEvent(state, returned)
    expect(state.toolCalls).toHaveLength(1)
    expect(state.toolCalls[0]).toMatchObject({
      id: "t1",
      result: "北京: 晴",
      status: "done",
    })
  })

  it("subagent lifecycle marks started then done", () => {
    const started = requireDomainEvent({
      event: "subagent.started",
      event_id: "evt_s1",
      ...base,
      cursor: "run_01:0001",
      payload: { subagent_id: "sa1", name: "researcher", description: "查资料" },
    })
    const finished = requireDomainEvent({
      event: "subagent.finished",
      event_id: "evt_s2",
      ...base,
      cursor: "run_01:0002",
      payload: { subagent_id: "sa1", name: "researcher" },
    })
    let state = applySessionEvent(createSessionStreamState(), started)
    expect(state.subagents[0]).toMatchObject({ id: "sa1", status: "running" })
    state = applySessionEvent(state, finished)
    expect(state.subagents[0]?.status).toBe("done")
  })

  it("thinking.delta accumulates reasoning text", () => {
    const a = requireDomainEvent({
      event: "thinking.delta",
      event_id: "evt_k1",
      ...base,
      cursor: "run_01:0001",
      payload: { message_id: "m1", delta: "先想" },
    })
    const b = requireDomainEvent({
      event: "thinking.delta",
      event_id: "evt_k2",
      ...base,
      cursor: "run_01:0002",
      payload: { message_id: "m1", delta: "再想" },
    })
    let state = applySessionEvent(createSessionStreamState(), a)
    state = applySessionEvent(state, b)
    expect(state.thinking).toBe("先想再想")
  })

  it("a new user turn resets the activity but keeps messages", () => {
    const todoEvent = requireDomainEvent({
      event: "todo.updated",
      event_id: "evt_t",
      ...base,
      cursor: "run_01:0001",
      payload: { todos: [{ content: "x", status: "completed" }] },
    })
    let state = applySessionEvent(createSessionStreamState(), todoEvent)
    expect(state.todos).toHaveLength(1)
    state = appendUserMessage(state, { id: "u2", content: "下一轮" })
    expect(state.todos).toEqual([])
    expect(state.toolCalls).toEqual([])
    expect(state.messages.some((message) => message.content === "下一轮")).toBe(
      true,
    )
  })
})
