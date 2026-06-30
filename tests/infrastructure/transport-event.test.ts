import { describe, expect, it } from "vitest"

import { toSessionStreamEvent } from "@/infrastructure/transport-event-mapper"
import { parseTransportEvent } from "@/infrastructure/transport-event-schema"

describe("parseTransportEvent", () => {
  it("accepts a valid message delta envelope and maps it into a domain event", () => {
    const transportEvent = parseTransportEvent({
      event: "message.delta",
      event_id: "evt_01",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: {
        segment_id: "msg_01",
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
      segmentId: "msg_01",
      role: "assistant",
      delta: "Hello",
    })
  })

  it("does not require a sort field in the transport envelope", () => {
    const transportEvent = parseTransportEvent({
      event: "message.delta",
      event_id: "evt_no_sort_field",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { segment_id: "msg_01", delta: "Hi", role: "assistant" },
    })
    expect(toSessionStreamEvent(transportEvent)).toMatchObject({
      kind: "message-delta",
      eventId: "evt_no_sort_field",
    })
  })

  it("accepts a non-'completed' terminal status without dropping the run end (forward-compat)", () => {
    const ev = parseTransportEvent({
      event: "run.completed",
      event_id: "evt_term",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      timestamp: "2026-05-28T12:00:00.000Z",
      payload: { run_id: "run_01", status: "cancelled" },
    })
    expect(toSessionStreamEvent(ev)?.kind).toBe("run-completed")
  })

  it("accepts run.created envelopes and maps them to no domain event", () => {
    const transportEvent = parseTransportEvent({
      event: "run.created",
      event_id: "evt_00",
      session_id: "ses_01",
      conversation_id: "conv_01",
      run_id: "run_01",
      timestamp: "2026-05-28T11:59:59.000Z",
      payload: {
        run_id: "run_01",
      },
    })

    expect(toSessionStreamEvent(transportEvent)).toBeNull()
  })

  it("keeps session.created title required", () => {
    expect(() =>
      parseTransportEvent({
        event: "session.created",
        event_id: "evt_title",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        timestamp: "2026-05-28T11:59:58.000Z",
        payload: {
          session_id: "ses_01",
          conversation_id: "conv_01",
          owner_id: "usr_01",
        },
      }),
    ).toThrowError(/title/i)
  })

  it("rejects extra top-level fields", () => {
    expect(() =>
      parseTransportEvent({
        event: "run.completed",
        event_id: "evt_02",
        session_id: "ses_01",
        conversation_id: "conv_01",
        run_id: "run_01",
        timestamp: "2026-05-28T12:00:01.000Z",
        payload: { run_id: "run_01", status: "completed" },
        injected: true,
      }),
    ).toThrowError(/Unrecognized key/)
  })
})
