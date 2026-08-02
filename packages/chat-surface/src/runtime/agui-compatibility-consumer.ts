import stableStringify from "fast-json-stable-stringify"
import { z } from "zod"

import {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_LIMITS,
  AGUI_PRESENTATION_PROFILE_REVISION,
  SESSION_AGUI_CONTRACT_REVISION,
  type AguiPresentationSnapshotAuthority,
} from "@kokoro/session-client/agui-presentation"

import {
  createAguiProjectionAdapter,
  type ChatAguiPresentationMutation,
} from "./agui-presentation-adapter.js"

export const AGUI_COMPATIBILITY_CONSUMER_MAXIMUM_INPUT_BYTES = 16_777_216
export const AGUI_COMPATIBILITY_CONSUMER_RECEIPT_PROFILE =
  "kokoro-web-agui-compatibility-consumer-receipt.v1" as const

const PROVIDER_PROFILE = "kokoro-session-agui-compatibility-output.v1" as const
const MAXIMUM_FRAMES = 64
const MAXIMUM_PAGES = MAXIMUM_FRAMES + 1
const maximumUint64 = 18_446_744_073_709_551_615n
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u
const positiveUint64Pattern = /^[1-9][0-9]{0,19}$/u
const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u
const cursorPattern = /^(?=.*[A-Za-z._~-])[A-Za-z0-9._~-]+$/u
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u
const candidateRefPattern = /^agui_candidate:sha256:[0-9a-f]{64}$/u
const publicSourceEventIdPattern =
  /^presentation\.event:(?![A-Za-z0-9._:-]*agent\.event)[A-Za-z0-9][A-Za-z0-9._:-]*$/u

const idSchema = z.string().min(1).max(128).regex(idPattern)
const uint64Schema = z.string().regex(uint64Pattern).refine((value) => BigInt(value) <= maximumUint64)
const positiveUint64Schema = z.string().regex(positiveUint64Pattern)
  .refine((value) => BigInt(value) <= maximumUint64)
const requiredUnknownSchema = z.unknown().refine((value) => value !== undefined)
const receiptSchema = z.strictObject({
  candidateRef: z.string().regex(candidateRefPattern),
  publicSourceEventId: z.string().min(20).max(128).regex(publicSourceEventIdPattern),
  durableSeq: positiveUint64Schema,
  projectionPayloadDigest: z.string().regex(sha256Pattern),
})
const admissionSchema = receiptSchema.extend({ outcome: z.literal("committed") }).strict()
const frameSchema = z.strictObject({
  id: z.string().min(16).max(2_048).regex(cursorPattern),
  event: z.enum([
    "RUN_STARTED",
    "RUN_FINISHED",
    "RUN_ERROR",
    "TEXT_MESSAGE_START",
    "TEXT_MESSAGE_CONTENT",
    "TEXT_MESSAGE_END",
    "ACTIVITY_SNAPSHOT",
    "CUSTOM",
  ]),
  data: z.string(),
})
const replayPageSchema = z.strictObject({
  afterDurableSeq: uint64Schema,
  frames: z.array(frameSchema).max(512),
  hasMore: z.boolean(),
  nextAfterDurableSeq: uint64Schema,
})
const providerOutputSchema = z.strictObject({
  profileRevision: z.literal(PROVIDER_PROFILE),
  scope: z.strictObject({
    siteId: idSchema,
    sessionId: idSchema,
    streamEpoch: positiveUint64Schema,
  }),
  producer: z.strictObject({
    producerInstanceRef: idSchema,
    producerGeneration: positiveUint64Schema,
  }),
  initialSnapshot: requiredUnknownSchema,
  admissions: z.array(admissionSchema).min(1).max(MAXIMUM_FRAMES),
  replay: z.strictObject({
    pageLimit: z.number().int().min(1).max(512),
    pages: z.array(replayPageSchema).min(1).max(MAXIMUM_PAGES),
    frameCount: z.number().int().min(1).max(MAXIMUM_FRAMES),
    finalAfterDurableSeq: positiveUint64Schema,
  }),
  finalSnapshot: requiredUnknownSchema,
  receipts: z.array(receiptSchema).min(1).max(MAXIMUM_FRAMES),
})

type ProviderOutput = z.infer<typeof providerOutputSchema>
type ProviderReceipt = z.infer<typeof receiptSchema>

export type AguiCompatibilityConsumerReceipt = Readonly<{
  profileRevision: typeof AGUI_COMPATIBILITY_CONSUMER_RECEIPT_PROFILE
  providerProfileRevision: typeof PROVIDER_PROFILE
  scope: Readonly<{ siteId: string; sessionId: string; streamEpoch: string }>
  consumed: Readonly<{
    pageCount: number
    frameCount: number
    finalDurableSeq: string
    authorityCommitCount: number
    durableDispatchCount: number
  }>
  authority: Readonly<{
    initialDurableSeq: "0"
    finalDurableSeq: string
    finalCursor: string
    runBindingCount: number
    messageBindingCount: number
    sessionSnapshotDigest: string
    localSnapshotDigest: string
    finalSnapshotEqual: true
  }>
  coverage: Readonly<{
    bindingAuthority: true
    runLifecycle: true
    textLifecycle: true
    terminalLifecycle: true
    dispatchBeforeCommit: true
  }>
  providerReceiptsDigest: string
  receiptDigest: string
}>

export class AguiCompatibilityConsumerError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = "AguiCompatibilityConsumerError"
  }
}

function fail(code: string): never {
  throw new AguiCompatibilityConsumerError(code)
}

function canonical(value: unknown): string {
  const encoded = stableStringify(value)
  if (encoded === undefined) fail("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_INVALID")
  return encoded
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonical(value))
  const result = await crypto.subtle.digest("SHA-256", bytes)
  return `sha256:${Array.from(new Uint8Array(result), (byte) =>
    byte.toString(16).padStart(2, "0")).join("")}`
}

function assertJsonBudget(value: unknown): void {
  const stack: Array<Readonly<{ value: unknown; depth: number }>> = [{ value, depth: 0 }]
  let nodes = 0
  while (stack.length > 0) {
    const current = stack.pop()
    if (current === undefined) break
    nodes += 1
    if (nodes > 131_072 || current.depth > 64) {
      fail("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_CAPACITY_EXCEEDED")
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 })
    } else if (current.value !== null && typeof current.value === "object") {
      for (const child of Object.values(current.value)) {
        stack.push({ value: child, depth: current.depth + 1 })
      }
    }
  }
}

function decodeProviderOutput(bytes: Uint8Array): ProviderOutput {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) {
    fail("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_INVALID")
  }
  if (bytes.byteLength > AGUI_COMPATIBILITY_CONSUMER_MAXIMUM_INPUT_BYTES) {
    fail("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_CAPACITY_EXCEEDED")
  }
  let raw: unknown
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
  } catch {
    fail("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_INVALID")
  }
  assertJsonBudget(raw)
  const parsed = providerOutputSchema.safeParse(raw)
  if (!parsed.success) fail("AGUI_COMPATIBILITY_PROVIDER_OUTPUT_INVALID")
  return parsed.data
}

function receiptsMatch(input: ProviderOutput): boolean {
  if (input.admissions.length !== input.receipts.length) return false
  const candidateRefs = new Set<string>()
  const sourceEventIds = new Set<string>()
  for (const [index, admission] of input.admissions.entries()) {
    const receipt = input.receipts[index]
    if (
      receipt === undefined || admission.candidateRef !== receipt.candidateRef ||
      admission.publicSourceEventId !== receipt.publicSourceEventId ||
      admission.durableSeq !== receipt.durableSeq ||
      admission.projectionPayloadDigest !== receipt.projectionPayloadDigest ||
      receipt.durableSeq !== String(index + 1) || candidateRefs.has(receipt.candidateRef) ||
      sourceEventIds.has(receipt.publicSourceEventId)
    ) return false
    candidateRefs.add(receipt.candidateRef)
    sourceEventIds.add(receipt.publicSourceEventId)
  }
  return true
}

function validateSnapshot(
  snapshot: unknown,
  input: ProviderOutput,
  errorCode: "AGUI_COMPATIBILITY_INITIAL_AUTHORITY_INVALID" | "AGUI_COMPATIBILITY_FINAL_AUTHORITY_MISMATCH",
): AguiPresentationSnapshotAuthority {
  try {
    const probe = createAguiProjectionAdapter({
      grant: {
        sessionId: input.scope.sessionId,
        sessionContractRevision: SESSION_AGUI_CONTRACT_REVISION,
        presentationProfileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
      },
      snapshotAuthority: snapshot as AguiPresentationSnapshotAuthority,
      dispatch() {
        return "applied"
      },
    })
    return probe.getSnapshotAuthority()
  } catch {
    fail(errorCode)
  }
}

function mutationCoverage(
  mutation: ChatAguiPresentationMutation,
  coverage: { runStart: boolean; textStart: boolean; textContent: boolean; textEnd: boolean; terminal: boolean },
): void {
  if (mutation.type === "agui.lifecycle" && mutation.phase === "run-started") coverage.runStart = true
  if (mutation.type === "agui.lifecycle" && ["run-finished", "run-error"].includes(mutation.phase)) {
    coverage.terminal = true
  }
  if (mutation.type === "agui.text" && mutation.phase === "start") coverage.textStart = true
  if (mutation.type === "agui.text" && mutation.phase === "content") coverage.textContent = true
  if (mutation.type === "agui.text" && mutation.phase === "end") coverage.textEnd = true
}

export async function consumeAguiCompatibilityProviderOutput(
  bytes: Uint8Array,
): Promise<AguiCompatibilityConsumerReceipt> {
  const input = decodeProviderOutput(bytes)
  if (!receiptsMatch(input)) fail("AGUI_COMPATIBILITY_RECEIPT_MISMATCH")

  const initial = validateSnapshot(input.initialSnapshot, input, "AGUI_COMPATIBILITY_INITIAL_AUTHORITY_INVALID")
  if (
    initial.durableSeq !== "0" || initial.lastRecordedAt !== null ||
    initial.runBindings.length !== 0 || initial.messageBindings.length !== 0 ||
    initial.sessionId !== input.scope.sessionId || initial.streamEpoch !== input.scope.streamEpoch
  ) fail("AGUI_COMPATIBILITY_INITIAL_AUTHORITY_INVALID")

  let beforeDispatch = initial
  let expectedReceipt: ProviderReceipt | undefined
  let expectedProjectionDigest: string | undefined
  let durableDispatchCount = 0
  let dispatchBeforeCommit = true
  const coverage = { runStart: false, textStart: false, textContent: false, textEnd: false, terminal: false }
  const adapter = createAguiProjectionAdapter({
    grant: {
      sessionId: input.scope.sessionId,
      sessionContractRevision: SESSION_AGUI_CONTRACT_REVISION,
      presentationProfileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
      cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
    },
    snapshotAuthority: input.initialSnapshot as AguiPresentationSnapshotAuthority,
    dispatch(mutation) {
      if (!mutation.durable || expectedReceipt === undefined || expectedProjectionDigest === undefined) {
        fail("AGUI_COMPATIBILITY_DISPATCH_INVALID")
      }
      if (canonical(adapter.getSnapshotAuthority()) !== canonical(beforeDispatch)) dispatchBeforeCommit = false
      if (
        mutation.source.sourceEventId !== expectedReceipt.publicSourceEventId ||
        mutation.source.durableSeq !== expectedReceipt.durableSeq ||
        expectedProjectionDigest !== expectedReceipt.projectionPayloadDigest
      ) fail("AGUI_COMPATIBILITY_RECEIPT_MISMATCH")
      durableDispatchCount += 1
      mutationCoverage(mutation, coverage)
      return "applied"
    },
  })

  let authorityCommitCount = 0
  let frameIndex = 0
  let expectedAfterDurableSeq = "0"
  for (const [pageIndex, page] of input.replay.pages.entries()) {
    const isLastPage = pageIndex === input.replay.pages.length - 1
    if (
      page.afterDurableSeq !== expectedAfterDurableSeq || page.frames.length > input.replay.pageLimit ||
      page.hasMore === isLastPage || (page.hasMore && page.frames.length === 0)
    ) fail("AGUI_COMPATIBILITY_REPLAY_INVALID")
    for (const frame of page.frames) {
      if (new TextEncoder().encode(frame.data).byteLength > AGUI_PRESENTATION_LIMITS.maximumFrameBytes) {
        fail("AGUI_COMPATIBILITY_REPLAY_INVALID")
      }
      const receipt = input.receipts[frameIndex]
      if (receipt === undefined) fail("AGUI_COMPATIBILITY_REPLAY_INVALID")
      let payload: unknown
      try {
        payload = JSON.parse(frame.data) as unknown
      } catch {
        fail("AGUI_COMPATIBILITY_REPLAY_INVALID")
      }
      expectedReceipt = receipt
      expectedProjectionDigest = await digest(payload)
      beforeDispatch = adapter.getSnapshotAuthority()
      try {
        adapter.accept(frame)
      } catch (error) {
        if (error instanceof AguiCompatibilityConsumerError) throw error
        fail("AGUI_COMPATIBILITY_REPLAY_INVALID")
      }
      const after = adapter.getSnapshotAuthority()
      if (
        after.durableSeq !== receipt.durableSeq || after.cursor !== frame.id ||
        BigInt(after.durableSeq) !== BigInt(beforeDispatch.durableSeq) + 1n
      ) fail("AGUI_COMPATIBILITY_REPLAY_INVALID")
      authorityCommitCount += 1
      frameIndex += 1
      expectedAfterDurableSeq = after.durableSeq
    }
    if (
      page.nextAfterDurableSeq !== expectedAfterDurableSeq ||
      (!page.hasMore && page.nextAfterDurableSeq !== input.replay.finalAfterDurableSeq)
    ) fail("AGUI_COMPATIBILITY_REPLAY_INVALID")
  }

  if (
    frameIndex !== input.replay.frameCount || frameIndex !== input.receipts.length ||
    expectedAfterDurableSeq !== input.replay.finalAfterDurableSeq ||
    durableDispatchCount !== frameIndex || authorityCommitCount !== frameIndex
  ) fail("AGUI_COMPATIBILITY_REPLAY_INVALID")

  const localFinal = adapter.getSnapshotAuthority()
  const sessionFinal = validateSnapshot(input.finalSnapshot, input, "AGUI_COMPATIBILITY_FINAL_AUTHORITY_MISMATCH")
  const localCanonical = canonical(localFinal)
  const sessionCanonical = canonical(sessionFinal)
  if (
    sessionCanonical !== canonical(input.finalSnapshot) || localCanonical !== sessionCanonical ||
    localFinal.durableSeq !== input.replay.finalAfterDurableSeq ||
    localFinal.runBindings.length === 0 || localFinal.messageBindings.length === 0
  ) fail("AGUI_COMPATIBILITY_FINAL_AUTHORITY_MISMATCH")
  if (!dispatchBeforeCommit || !coverage.runStart || !coverage.textStart || !coverage.textContent ||
      !coverage.textEnd || !coverage.terminal) {
    fail("AGUI_COMPATIBILITY_COVERAGE_INCOMPLETE")
  }

  const sessionSnapshotDigest = await digest(sessionFinal)
  const localSnapshotDigest = await digest(localFinal)
  const providerReceiptsDigest = await digest(input.receipts)
  const receiptBase = Object.freeze({
    profileRevision: AGUI_COMPATIBILITY_CONSUMER_RECEIPT_PROFILE,
    providerProfileRevision: PROVIDER_PROFILE,
    scope: Object.freeze({ ...input.scope }),
    consumed: Object.freeze({
      pageCount: input.replay.pages.length,
      frameCount: frameIndex,
      finalDurableSeq: localFinal.durableSeq,
      authorityCommitCount,
      durableDispatchCount,
    }),
    authority: Object.freeze({
      initialDurableSeq: "0" as const,
      finalDurableSeq: localFinal.durableSeq,
      finalCursor: localFinal.cursor,
      runBindingCount: localFinal.runBindings.length,
      messageBindingCount: localFinal.messageBindings.length,
      sessionSnapshotDigest,
      localSnapshotDigest,
      finalSnapshotEqual: true as const,
    }),
    coverage: Object.freeze({
      bindingAuthority: true as const,
      runLifecycle: true as const,
      textLifecycle: true as const,
      terminalLifecycle: true as const,
      dispatchBeforeCommit: true as const,
    }),
    providerReceiptsDigest,
  })
  return Object.freeze({ ...receiptBase, receiptDigest: await digest(receiptBase) })
}
