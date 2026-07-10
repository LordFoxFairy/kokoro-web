// GENERATED — DO NOT EDIT. Source: contract/spec/events.yaml
// Regenerate: python3 contract/generate.py

export const SESSION_EVENT_NAMES = [
  "session.created",
  "run.created",
  "message.user",
  "message.delta",
  "message.completed",
  "thinking.delta",
  "tool.invoked",
  "tool.output.delta",
  "tool.awaiting_approval",
  "tool.returned",
  "delivery.created",
  "todo.updated",
  "subagent.started",
  "subagent.finished",
  "subagent.thinking.delta",
  "subagent.text.delta",
  "subagent.text.completed",
  "subagent.tool.invoked",
  "subagent.tool.returned",
  "run.completed",
  "run.failed",
] as const

export type SessionEventName = (typeof SESSION_EVENT_NAMES)[number]
