// GENERATED — DO NOT EDIT. Source: contract/spec/events.yaml
// Regenerate: python3 contract/generate.py

export const SESSION_EVENT_NAMES = [
  "session.updated",
  "branch.created",
  "branch.activated",
  "message.created",
  "message.part.updated",
  "run.launch.updated",
  "run.view.updated",
  "run.control.updated",
  "run.cost.updated",
  "command.receipt.updated",
] as const

export type SessionEventName = (typeof SESSION_EVENT_NAMES)[number]
