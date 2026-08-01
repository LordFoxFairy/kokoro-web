import type {
  AguiActivityEvent,
  AguiCustomEvent,
  AguiDecodedFrame,
  AguiDurableFrame,
} from "@kokoro/session-client"

type DurableMutationAuthority = Readonly<{
  durable: true
  cursor: string
  source: AguiDurableFrame["data"]["source"]
  runBindingRef?: string
  messageBindingRef?: string
}>

export type ChatAguiPresentationMutation =
  | (DurableMutationAuthority & Readonly<{
      type: "agui.lifecycle"
      phase: "run-started"
      threadId: string
      runId: string
      parentRunId?: string
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.lifecycle"
      phase: "run-finished"
      threadId: string
      runId: string
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.lifecycle"
      phase: "run-error"
      code: string
      message: string
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.text"
      phase: "start"
      presentationMessageId: string
      role: "assistant"
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.text"
      phase: "content"
      presentationMessageId: string
      delta: string
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.text"
      phase: "end"
      presentationMessageId: string
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.activity"
      presentationMessageId: string
      activityType: AguiActivityEvent["activityType"]
      content: AguiActivityEvent["content"]
      replace: true
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.custom"
      name: AguiCustomEvent["name"]
      value: AguiCustomEvent["value"]
    }>)
  | Readonly<{
      type: "agui.control"
      durable: false
      action: "retry-same-cursor"
      sessionId: string
      streamEpoch: string
      lastDurableCursor: string
      retryAfterMs?: number
    }>

function durableAuthority(frame: AguiDurableFrame): DurableMutationAuthority {
  return Object.freeze({
    durable: true,
    cursor: frame.id,
    source: frame.data.source,
    ...(frame.data.presentationRunBindingRef === undefined
      ? {}
      : { runBindingRef: frame.data.presentationRunBindingRef }),
    ...(frame.data.presentationMessageBindingRef === undefined
      ? {}
      : { messageBindingRef: frame.data.presentationMessageBindingRef }),
  })
}

function unreachableEvent(value: unknown): never {
  throw new Error(`Unreachable strict AG-UI event: ${JSON.stringify(value)}`)
}

/**
 * Converts only the Session-owned strict presentation subset into a typed Chat
 * boundary mutation. It deliberately does not manufacture a SessionEvent or
 * mutate the active ChatProjection store.
 */
export function mapAguiPresentationFrame(
  frame: AguiDecodedFrame,
): ChatAguiPresentationMutation | null {
  if (frame.kind === "replay") return null
  if (frame.kind === "control") {
    return Object.freeze({
      type: "agui.control",
      durable: false,
      action: frame.data.action,
      sessionId: frame.data.sessionId,
      streamEpoch: frame.data.streamEpoch,
      lastDurableCursor: frame.data.lastDurableCursor,
      ...(frame.data.retryAfterMs === undefined ? {} : { retryAfterMs: frame.data.retryAfterMs }),
    })
  }

  const authority = durableAuthority(frame)
  const event = frame.data.event
  switch (event.type) {
    case "RUN_STARTED":
      return Object.freeze({
        ...authority,
        type: "agui.lifecycle",
        phase: "run-started",
        threadId: event.threadId,
        runId: event.runId,
        ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
      })
    case "RUN_FINISHED":
      return Object.freeze({
        ...authority,
        type: "agui.lifecycle",
        phase: "run-finished",
        threadId: event.threadId,
        runId: event.runId,
      })
    case "RUN_ERROR":
      return Object.freeze({
        ...authority,
        type: "agui.lifecycle",
        phase: "run-error",
        code: event.code,
        message: event.message,
      })
    case "TEXT_MESSAGE_START":
      return Object.freeze({
        ...authority,
        type: "agui.text",
        phase: "start",
        presentationMessageId: event.messageId,
        role: event.role,
      })
    case "TEXT_MESSAGE_CONTENT":
      return Object.freeze({
        ...authority,
        type: "agui.text",
        phase: "content",
        presentationMessageId: event.messageId,
        delta: event.delta,
      })
    case "TEXT_MESSAGE_END":
      return Object.freeze({
        ...authority,
        type: "agui.text",
        phase: "end",
        presentationMessageId: event.messageId,
      })
    case "ACTIVITY_SNAPSHOT":
      return Object.freeze({
        ...authority,
        type: "agui.activity",
        presentationMessageId: event.messageId,
        activityType: event.activityType,
        content: event.content,
        replace: event.replace,
      })
    case "CUSTOM":
      return Object.freeze({
        ...authority,
        type: "agui.custom",
        name: event.name,
        value: event.value,
      })
    default:
      return unreachableEvent(event)
  }
}

export type DormantAguiProjectionPort = Readonly<{
  dispatch(mutation: ChatAguiPresentationMutation): void
}>

/**
 * Dormant composition seam. No product controller instantiates this adapter
 * until the Session provider and cross-repository compatibility evidence ship.
 */
export function createDormantAguiProjectionAdapter(port: DormantAguiProjectionPort): Readonly<{
  accept(frame: AguiDecodedFrame): void
}> {
  return Object.freeze({
    accept(frame) {
      const mutation = mapAguiPresentationFrame(frame)
      if (mutation !== null) port.dispatch(mutation)
    },
  })
}
