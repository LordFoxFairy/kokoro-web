import {
  parseSessionEvent,
  toSessionStreamEvent,
} from "@/infrastructure/protocol/session-event"

const transportEvents = [
  parseSessionEvent({
    event: "session.created",
    event_id: "evt_00",
    session_id: "ses_01",
    conversation_id: "conv_01",
    run_id: "run_01",
    cursor: "1748428800-000011",
    timestamp: "2026-05-28T12:00:00.000Z",
    payload: {
      session_id: "ses_01",
      conversation_id: "conv_01",
      owner_id: "usr_01",
      title: "Warm launch preview",
    },
  }),
  parseSessionEvent({
    event: "message.delta",
    event_id: "evt_01",
    session_id: "ses_01",
    conversation_id: "conv_01",
    run_id: "run_01",
    cursor: "1748428800-000012",
    timestamp: "2026-05-28T12:00:00.500Z",
    payload: { message_id: "msg_01", delta: "Hello ", role: "assistant" },
  }),
  parseSessionEvent({
    event: "message.completed",
    event_id: "evt_02",
    session_id: "ses_01",
    conversation_id: "conv_01",
    run_id: "run_01",
    cursor: "1748428800-000013",
    timestamp: "2026-05-28T12:00:01.000Z",
    payload: {
      message_id: "msg_01",
      role: "assistant",
      content: "Hello from replay-safe shell.",
    },
  }),
  parseSessionEvent({
    event: "run.completed",
    event_id: "evt_03",
    session_id: "ses_01",
    conversation_id: "conv_01",
    run_id: "run_01",
    cursor: "1748428800-000014",
    timestamp: "2026-05-28T12:00:02.000Z",
    payload: { run_id: "run_01", status: "completed" },
  }),
]

export const seedEvents = transportEvents.flatMap((event) => {
  const mappedEvent = toSessionStreamEvent(event)

  return mappedEvent ? [mappedEvent] : []
})
