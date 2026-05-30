import { describe, expect, it } from "vitest"

import {
  applySessionEvent,
  createSessionStreamState,
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

  it("builds an ordered timeline interleaving thinking, tool, and message items", () => {
    const events = [
      {
        event: "thinking.summary",
        event_id: "evt_01",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000010",
        timestamp: "2026-05-28T12:00:00.000Z",
        payload: { run_id: "run_01", summary: "decide to search" },
      },
      {
        event: "tool.started",
        event_id: "evt_02",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000011",
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { tool_call_id: "call_01", tool_name: "echo_search" },
      },
      {
        event: "tool.completed",
        event_id: "evt_03",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000012",
        timestamp: "2026-05-28T12:00:02.000Z",
        payload: {
          tool_call_id: "call_01",
          tool_name: "echo_search",
          status: "ok",
        },
      },
      {
        event: "message.delta",
        event_id: "evt_04",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000013",
        timestamp: "2026-05-28T12:00:03.000Z",
        payload: { message_id: "msg_01", delta: "He", role: "assistant" },
      },
      {
        event: "message.delta",
        event_id: "evt_05",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000014",
        timestamp: "2026-05-28T12:00:04.000Z",
        payload: { message_id: "msg_01", delta: "llo", role: "assistant" },
      },
      {
        event: "message.completed",
        event_id: "evt_06",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000015",
        timestamp: "2026-05-28T12:00:05.000Z",
        payload: { message_id: "msg_01", role: "assistant", content: "Hello" },
      },
      {
        event: "run.completed",
        event_id: "evt_07",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000016",
        timestamp: "2026-05-28T12:00:06.000Z",
        payload: { run_id: "run_01", status: "completed" },
      },
    ] as const

    const state = events
      .map(requireDomainEvent)
      .reduce(applySessionEvent, createSessionStreamState())

    expect(state.timeline).toEqual([
      { type: "thinking", summary: "decide to search" },
      {
        type: "tool",
        toolCallId: "call_01",
        toolName: "echo_search",
        status: "done",
      },
      { type: "message", id: "msg_01", role: "assistant", content: "Hello" },
    ])
    expect(state.runStatus).toBe("completed")
    // messages view stays derivable for existing consumers.
    expect(state.messages).toEqual([
      { id: "msg_01", role: "assistant", content: "Hello" },
    ])
  })

  it("keeps a tool item running until its completion arrives", () => {
    const started = requireDomainEvent({
      event: "tool.started",
      event_id: "evt_01",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000010",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { tool_call_id: "call_01", tool_name: "echo_search" },
    })

    const runningState = applySessionEvent(createSessionStreamState(), started)
    expect(runningState.timeline).toEqual([
      {
        type: "tool",
        toolCallId: "call_01",
        toolName: "echo_search",
        status: "running",
      },
    ])

    const completed = requireDomainEvent({
      event: "tool.completed",
      event_id: "evt_02",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000011",
      timestamp: "2026-05-28T12:00:01.000Z",
      payload: {
        tool_call_id: "call_01",
        tool_name: "echo_search",
        status: "ok",
      },
    })

    const doneState = applySessionEvent(runningState, completed)
    expect(doneState.timeline).toEqual([
      {
        type: "tool",
        toolCallId: "call_01",
        toolName: "echo_search",
        status: "done",
      },
    ])
  })

  it("is idempotent when the interleaved sequence is replayed", () => {
    const inputs = [
      {
        event: "thinking.summary",
        event_id: "evt_01",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000010",
        timestamp: "2026-05-28T12:00:00.000Z",
        payload: { run_id: "run_01", summary: "think" },
      },
      {
        event: "tool.started",
        event_id: "evt_02",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000011",
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { tool_call_id: "call_01", tool_name: "echo_search" },
      },
      {
        event: "tool.completed",
        event_id: "evt_03",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000012",
        timestamp: "2026-05-28T12:00:02.000Z",
        payload: {
          tool_call_id: "call_01",
          tool_name: "echo_search",
          status: "ok",
        },
      },
    ].map(requireDomainEvent)

    const once = inputs.reduce(applySessionEvent, createSessionStreamState())
    const twice = inputs.reduce(applySessionEvent, once)

    expect(twice.timeline).toEqual(once.timeline)
    expect(twice.seenEventIds).toEqual(["evt_01", "evt_02", "evt_03"])
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
