// GENERATED — DO NOT EDIT. Source: contract/spec/events.yaml
// Regenerate: python3 contract/generate.py

export const SESSION_EVENT_NAMES = [
  "session.created",
  "run.created",
  "message.delta",
  "message.completed",
  "thinking.delta",
  "tool.invoked",
  "tool.awaiting_approval",
  "tool.returned",
  "todo.updated",
  "subagent.started",
  "subagent.finished",
  "subagent.text.delta",
  "subagent.text.completed",
  "run.completed",
  "run.failed",
] as const

export type SessionEventName = (typeof SESSION_EVENT_NAMES)[number]
