import type {
  AguiActivityEvent,
  AguiCursorBinding,
  AguiCustomEvent,
  AguiDecodedFrame,
  AguiDurableFrame,
  AguiGrantBinding,
  AguiPresentationDecoder,
  AguiSseFrame,
} from "@kokoro/session-client/agui-presentation-dormant"
import { createAguiPresentationDecoder } from "@kokoro/session-client/agui-presentation-dormant"

type DurableMutationAuthority = Readonly<{
  durable: true
  cursor: string
  source: AguiDurableFrame["data"]["source"]
  runBindingRef?: string
  messageBindingRef?: string
}>

type ChatAguiActivityMutation<Event extends AguiActivityEvent = AguiActivityEvent> =
  Event extends AguiActivityEvent
    ? DurableMutationAuthority & Readonly<{
        type: "agui.activity"
        presentationMessageId: string
        activityType: Event["activityType"]
        content: Event["content"]
        replace: true
      }>
    : never

type ChatAguiCustomMutation<Event extends AguiCustomEvent = AguiCustomEvent> =
  Event extends AguiCustomEvent
    ? DurableMutationAuthority & Readonly<{
        type: "agui.custom"
        name: Event["name"]
        value: Event["value"]
      }>
    : never

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
  | ChatAguiActivityMutation
  | ChatAguiCustomMutation
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

function mapActivityMutation(
  authority: DurableMutationAuthority,
  event: AguiActivityEvent,
): ChatAguiActivityMutation {
  const project = <Event extends AguiActivityEvent>(candidate: Event): ChatAguiActivityMutation<Event> =>
    Object.freeze({
      ...authority,
      type: "agui.activity" as const,
      presentationMessageId: candidate.messageId,
      activityType: candidate.activityType,
      content: candidate.content,
      replace: candidate.replace,
    }) as ChatAguiActivityMutation<Event>

  switch (event.activityType) {
    case "kokoro.safe-summary.v1":
    case "kokoro.tool-preview.v1":
    case "kokoro.hitl.v1":
    case "kokoro.plan.v1":
    case "kokoro.subagent.v1":
    case "kokoro.media.v1":
    case "kokoro.artifact.v1":
    case "kokoro.cost.v1":
    case "kokoro.notice.v1":
    case "kokoro.error.v1":
      return project(event)
    default:
      return unreachableEvent(event)
  }
}

function mapCustomMutation(
  authority: DurableMutationAuthority,
  event: AguiCustomEvent,
): ChatAguiCustomMutation {
  const project = <Event extends AguiCustomEvent>(candidate: Event): ChatAguiCustomMutation<Event> =>
    Object.freeze({
      ...authority,
      type: "agui.custom" as const,
      name: candidate.name,
      value: candidate.value,
    }) as ChatAguiCustomMutation<Event>

  switch (event.name) {
    case "kokoro.session.replace.v1":
    case "kokoro.branch.replace.v1":
    case "kokoro.message.replace.v1":
    case "kokoro.run.replace.v1":
    case "kokoro.control.replace.v1":
    case "kokoro.receipt.replace.v1":
      return project(event)
    default:
      return unreachableEvent(event)
  }
}

/**
 * Converts only the Session-owned strict presentation subset into a typed Chat
 * boundary mutation. It deliberately does not manufacture a SessionEvent or
 * mutate the active ChatProjection store.
 */
function mapAguiPresentationFrame(
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
      return mapActivityMutation(authority, event)
    case "CUSTOM":
      return mapCustomMutation(authority, event)
    default:
      return unreachableEvent(event)
  }
}

export type DormantAguiProjectionPort = Readonly<{
  grant: AguiGrantBinding
  initialCursor: AguiCursorBinding
  limits?: Readonly<{
    streamIdentities?: number
    runs?: number
    messages?: number
  }>
  dispatch(mutation: ChatAguiPresentationMutation): void
}>

/**
 * Dormant composition seam. No product controller instantiates this adapter
 * until the Session provider and cross-repository compatibility evidence ship.
 */
export function createDormantAguiProjectionAdapter(port: DormantAguiProjectionPort): Readonly<{
  accept(frame: AguiSseFrame): void
  getResumeRequest: AguiPresentationDecoder["getResumeRequest"]
}> {
  const decoder = createAguiPresentationDecoder({
    grant: port.grant,
    initialCursor: port.initialCursor,
    ...(port.limits === undefined ? {} : { limits: port.limits }),
  })
  return Object.freeze({
    accept(frame) {
      const mutation = mapAguiPresentationFrame(decoder.decode(frame))
      if (mutation !== null) port.dispatch(mutation)
    },
    getResumeRequest: decoder.getResumeRequest,
  })
}
