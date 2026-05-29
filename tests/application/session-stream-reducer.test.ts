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
