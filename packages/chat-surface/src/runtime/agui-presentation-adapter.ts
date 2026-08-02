import type {
  AguiActivityEvent,
  AguiCustomEvent,
  AguiDecodedFrame,
  AguiDurableFrame,
  AguiGrantBinding,
  AguiPresentationMessageBindingRef,
  AguiPresentationMessageBinding,
  AguiPresentationMessageId,
  AguiPresentationOwnerBindingRef,
  AguiPresentationOwnerBinding,
  AguiPresentationDecoder,
  AguiPresentationRunBindingRef,
  AguiPresentationRunBinding,
  AguiPresentationRunId,
  AguiPresentationSnapshotAuthority,
  AguiPresentationThreadId,
  AguiSseFrame,
  AguiFrameDisposition,
} from "@kokoro/session-client/agui-presentation"
import {
  AguiPresentationProtocolError,
  createAguiPresentationDecoder,
} from "@kokoro/session-client/agui-presentation"
import { EventType } from "@ag-ui/core"

type DurableMutationAuthority = Readonly<{
  durable: true
  cursor: string
  source: AguiDurableFrame["data"]["source"]
  runBindingRef?: AguiPresentationRunBindingRef
  messageBindingRef?: AguiPresentationMessageBindingRef
  ownerBindingRef?: AguiPresentationOwnerBindingRef
  runBinding?: AguiPresentationRunBinding
  messageBinding?: AguiPresentationMessageBinding
  ownerBinding?: AguiPresentationOwnerBinding
}>

type ChatAguiActivityMutation<Event extends AguiActivityEvent = AguiActivityEvent> =
  Event extends AguiActivityEvent
    ? DurableMutationAuthority & Readonly<{
        type: "agui.activity"
        presentationMessageId: AguiPresentationMessageId
        activityType: Event["activityType"]
        content: Event["content"]
        event: Event
        replace: true
      }>
    : never

type ChatAguiCustomMutation<Event extends AguiCustomEvent = AguiCustomEvent> =
  Event extends AguiCustomEvent
    ? DurableMutationAuthority & Readonly<{
        type: "agui.custom"
        name: Event["name"]
        value: Event["value"]
        event: Event
      }>
    : never

export type ChatAguiPresentationMutation =
  | (DurableMutationAuthority & Readonly<{
      type: "agui.lifecycle"
      phase: "run-started"
      threadId: AguiPresentationThreadId
      runId: AguiPresentationRunId
      parentRunId?: AguiPresentationRunId
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.lifecycle"
      phase: "run-finished"
      threadId: AguiPresentationThreadId
      runId: AguiPresentationRunId
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
      presentationMessageId: AguiPresentationMessageId
      role: "assistant"
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.text"
      phase: "content"
      presentationMessageId: AguiPresentationMessageId
      delta: string
    }>)
  | (DurableMutationAuthority & Readonly<{
      type: "agui.text"
      phase: "end"
      presentationMessageId: AguiPresentationMessageId
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

function durableAuthority(
  frame: AguiDurableFrame,
  snapshotAuthority: AguiPresentationSnapshotAuthority,
): DurableMutationAuthority {
  const runBindingRef = frame.data.presentationRunBindingRef
  const messageBindingRef = frame.data.presentationMessageBindingRef
  const delta = frame.data.bindingAuthorityDelta
  const runBinding = delta.kind === "run.replace"
    ? delta.binding
    : runBindingRef === undefined
      ? undefined
      : snapshotAuthority.runBindings.find((binding) => binding.bindingRef === runBindingRef)
  const messageBinding = delta.kind === "message.replace"
    ? delta.binding
    : messageBindingRef === undefined
      ? undefined
      : snapshotAuthority.messageBindings.find((binding) => binding.bindingRef === messageBindingRef)
  const ownerBindingRef = frame.data.presentationOwnerBindingRef
  const ownerBinding = delta.kind === "owner.replace"
    ? delta.binding
    : ownerBindingRef === undefined
      ? undefined
      : snapshotAuthority.ownerBindings.find((binding) => binding.bindingRef === ownerBindingRef)
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
    ...(ownerBindingRef === undefined ? {} : { ownerBindingRef }),
    ...(runBinding === undefined ? {} : { runBinding }),
    ...(messageBinding === undefined ? {} : { messageBinding }),
    ...(ownerBinding === undefined ? {} : { ownerBinding }),
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
      event: candidate,
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
      event: candidate,
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
 * boundary mutation. It never manufactures a parallel durable protocol.
 */
function mapAguiPresentationFrame(
  frame: AguiDecodedFrame,
  snapshotAuthority: AguiPresentationSnapshotAuthority,
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

  const authority = durableAuthority(frame, snapshotAuthority)
  const event = frame.data.event
  switch (event.type) {
    case EventType.RUN_STARTED:
      return Object.freeze({
        ...authority,
        type: "agui.lifecycle",
        phase: "run-started",
        threadId: event.threadId,
        runId: event.runId,
        ...(event.parentRunId === undefined ? {} : { parentRunId: event.parentRunId }),
      })
    case EventType.RUN_FINISHED:
      return Object.freeze({
        ...authority,
        type: "agui.lifecycle",
        phase: "run-finished",
        threadId: event.threadId,
        runId: event.runId,
      })
    case EventType.RUN_ERROR:
      return Object.freeze({
        ...authority,
        type: "agui.lifecycle",
        phase: "run-error",
        code: event.code,
        message: event.message,
      })
    case EventType.TEXT_MESSAGE_START:
      return Object.freeze({
        ...authority,
        type: "agui.text",
        phase: "start",
        presentationMessageId: event.messageId,
        role: event.role,
      })
    case EventType.TEXT_MESSAGE_CONTENT:
      return Object.freeze({
        ...authority,
        type: "agui.text",
        phase: "content",
        presentationMessageId: event.messageId,
        delta: event.delta,
      })
    case EventType.TEXT_MESSAGE_END:
      return Object.freeze({
        ...authority,
        type: "agui.text",
        phase: "end",
        presentationMessageId: event.messageId,
      })
    case EventType.ACTIVITY_SNAPSHOT:
      return mapActivityMutation(authority, event)
    case EventType.CUSTOM:
      return mapCustomMutation(authority, event)
    default:
      return unreachableEvent(event)
  }
}

export type AguiProjectionPort = Readonly<{
  grant: AguiGrantBinding
  snapshotAuthority: AguiPresentationSnapshotAuthority
  limits?: Readonly<{
    streamIdentities?: number
    runs?: number
    messages?: number
  }>
  /**
   * Durable mutations use `mutation.cursor` as their idempotency key. A retry
   * after an uncertain acknowledgement must return `replayed` once that cursor
   * is already present, rather than applying the mutation twice.
   */
  dispatch(mutation: ChatAguiPresentationMutation): "applied" | "replayed" | "rejected"
}>

/**
 * Production projection seam. The caller owns the one ChatProjection store and
 * must durably acknowledge each cursor before decoder authority advances.
 */
export function createAguiProjectionAdapter(port: AguiProjectionPort): Readonly<{
  accept(frame: AguiSseFrame): AguiFrameDisposition
  getSnapshotAuthority: AguiPresentationDecoder["getSnapshotAuthority"]
  getResumeRequest: AguiPresentationDecoder["getResumeRequest"]
}> {
  const decoder = createAguiPresentationDecoder({
    grant: port.grant,
    snapshotAuthority: port.snapshotAuthority,
    ...(port.limits === undefined ? {} : { limits: port.limits }),
  })
  return Object.freeze({
    accept(frame) {
      const prepared = decoder.prepare(frame)
      const mutation = mapAguiPresentationFrame(prepared.decoded, decoder.getSnapshotAuthority())
      if (mutation === null) {
        prepared.commit(prepared.decoded.kind === "replay" ? "replayed" : "applied")
        return Object.freeze({ kind: "replay" })
      }
      const acknowledgement = port.dispatch(mutation)
      if (acknowledgement === "rejected") {
        // Rejection is an admission decision, never a durable acknowledgement.
        // Leaving the decoder's prepared frame uncommitted keeps resume authority
        // on the last accepted cursor and permits an exact retry after rehydrate.
        throw new AguiPresentationProtocolError("agui_projection_rejected")
      }
      if (acknowledgement !== "applied" && acknowledgement !== "replayed") {
        throw new AguiPresentationProtocolError("agui_dispatch_ack_invalid")
      }
      prepared.commit(acknowledgement)
      if (prepared.decoded.kind === "control") {
        return Object.freeze({
          kind: "draining",
          ...(prepared.decoded.data.retryAfterMs === undefined
            ? {}
            : { retryAfterMs: prepared.decoded.data.retryAfterMs }),
        })
      }
      return Object.freeze({ kind: acknowledgement === "replayed" ? "replay" : "durable" })
    },
    getSnapshotAuthority: decoder.getSnapshotAuthority,
    getResumeRequest: decoder.getResumeRequest,
  })
}
