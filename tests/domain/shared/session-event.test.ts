import { describe, expect, it } from "vitest"

import {
  parseSessionEvent,
  toSessionStreamEvent,
} from "@/infrastructure/protocol/session-event"

describe("parseSessionEvent", () => {
  it("accepts a valid message delta envelope and maps it into a domain event", () => {
    const transportEvent = parseSessionEvent({
      event: "message.delta",
      event_id: "evt_01",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      cursor: "1748428800-000012",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: {
        message_id: "msg_01",
        delta: "Hello",
        role: "assistant",
      },
    })

    const event = toSessionStreamEvent(transportEvent)

    expect(event).toEqual({
      kind: "message-delta",
      eventId: "evt_01",
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      messageId: "msg_01",
      role: "assistant",
      delta: "Hello",
    })
  })

  it("maps a tool.started envelope into a tool-started domain event", () => {
    const event = toSessionStreamEvent(
      parseSessionEvent({
        event: "tool.started",
        event_id: "evt_04",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000015",
        timestamp: "2026-05-28T12:00:03.000Z",
        payload: { tool_call_id: "call_01", tool_name: "echo_search" },
      }),
    )

    expect(event).toEqual({
      kind: "tool-started",
      eventId: "evt_04",
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      toolCallId: "call_01",
      toolName: "echo_search",
    })
  })

  it("maps a tool.completed envelope into a tool-completed domain event", () => {
    const event = toSessionStreamEvent(
      parseSessionEvent({
        event: "tool.completed",
        event_id: "evt_05",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000016",
        timestamp: "2026-05-28T12:00:04.000Z",
        payload: {
          tool_call_id: "call_01",
          tool_name: "echo_search",
          status: "ok",
        },
      }),
    )

    expect(event).toEqual({
      kind: "tool-completed",
      eventId: "evt_05",
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      toolCallId: "call_01",
      toolName: "echo_search",
      status: "ok",
    })
  })

  it("maps a thinking.summary envelope into a thinking-summary domain event", () => {
    const event = toSessionStreamEvent(
      parseSessionEvent({
        event: "thinking.summary",
        event_id: "evt_06",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000017",
        timestamp: "2026-05-28T12:00:05.000Z",
        payload: { run_id: "run_01", summary: "planning the search" },
      }),
    )

    expect(event).toEqual({
      kind: "thinking-summary",
      eventId: "evt_06",
      sessionId: "ses_01",
      conversationId: "conv_01",
      runId: "run_01",
      summary: "planning the search",
    })
  })

  it("rejects a tool.started payload missing the tool name", () => {
    expect(() =>
      parseSessionEvent({
        event: "tool.started",
        event_id: "evt_07",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000018",
        timestamp: "2026-05-28T12:00:06.000Z",
        payload: { tool_call_id: "call_01" },
      }),
    ).toThrowError()
  })

  it("rejects a tool.completed payload with extra fields", () => {
    expect(() =>
      parseSessionEvent({
        event: "tool.completed",
        event_id: "evt_08",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000019",
        timestamp: "2026-05-28T12:00:07.000Z",
        payload: {
          tool_call_id: "call_01",
          tool_name: "echo_search",
          status: "ok",
          injected: true,
        },
      }),
    ).toThrowError(/Unrecognized key/)
  })

  it("rejects extra top-level fields", () => {
    expect(() =>
      parseSessionEvent({
        event: "run.completed",
        event_id: "evt_02",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        cursor: "1748428800-000013",
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { run_id: "run_01", status: "completed" },
        injected: true,
      }),
    ).toThrowError(/Unrecognized key/)
  })
})
