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
