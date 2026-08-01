import { EventSchemas, EventType } from "@ag-ui/core";
import stableStringify from "fast-json-stable-stringify";
import { z } from "zod";

import { LAST_EVENT_ID_HEADER } from "./contracts.js";
import type { SessionCursor } from "./cursor-policy.js";
import {
  aguiPublicSourceEventIdSchema,
  aguiPresentationMessageBindingSchema,
  aguiPresentationMessageBindingRefSchema,
  aguiPresentationMessageIdSchema,
  aguiPresentationRunBindingSchema,
  aguiPresentationRunBindingRefSchema,
  aguiPresentationRunIdSchema,
  aguiPresentationThreadIdSchema,
  aguiPresentationBindingAuthorityDeltaSchema,
  type AguiPresentationBindingAuthorityDelta,
  type AguiPresentationMessageBindingRef,
  type AguiPresentationMessageBinding,
  type AguiPresentationRunBindingRef,
  type AguiPresentationRunBinding,
} from "./generated/agui-binding-authority.js";

export {
  aguiBindingAuthorityContractMetadata,
  aguiPublicSourceEventIdSchema,
  aguiPresentationMessageBindingSchema,
  aguiPresentationMessageBindingRefSchema,
  aguiPresentationMessageIdSchema,
  aguiPresentationRunBindingSchema,
  aguiPresentationRunBindingRefSchema,
  aguiPresentationRunIdSchema,
  aguiPresentationThreadIdSchema,
  aguiPresentationBindingAuthorityDeltaSchema,
  type AguiPresentationBindingAuthorityDelta,
  type AguiPresentationMessageBindingRef,
  type AguiPresentationMessageId,
  type AguiPresentationMessageBinding,
  type AguiPresentationRunBindingRef,
  type AguiPresentationRunId,
  type AguiPresentationRunBinding,
  type AguiPresentationThreadId,
  type AguiPublicSourceEventId,
} from "./generated/agui-binding-authority.js";

export const AGUI_PRESENTATION_PROFILE_REVISION = "kokoro-agui-presentation.v1" as const;
export const AGUI_CURSOR_PROFILE_REVISION = "opaque-session-cursor-v1" as const;
export const SESSION_AGUI_CONTRACT_REVISION = "session-agui-stream.v1" as const;
export const AGUI_PRESENTATION_AUTHORITY_LIMITS = Object.freeze({
  streamIdentities: 4_096,
  runs: 256,
  messages: 512,
});

export const AGUI_PRESENTATION_LIMITS = Object.freeze({
  maximumFrameBytes: 131_072,
  maximumEventBytes: 65_536,
  maximumJsonDepth: 12,
  maximumJsonNodes: 4_096,
  maximumObjectKeys: 64,
  maximumArrayItems: 256,
  maximumIdBytes: 128,
  maximumCursorBytes: 2_048,
});

/**
 * Retained wire payload excludes bounded Set/Map container overhead. Historical
 * replay identities retain only cursor/source strings; raw frames retain only
 * the last committed and the one currently awaiting an external acknowledgement.
 */
export const AGUI_PRESENTATION_REPLAY_MEMORY_BOUNDS = Object.freeze({
  retainedWireFrames: 2,
  maximumRetainedWireBytes: AGUI_PRESENTATION_LIMITS.maximumFrameBytes * 2,
  historicalCursorIdentityBytes:
    AGUI_PRESENTATION_AUTHORITY_LIMITS.streamIdentities * AGUI_PRESENTATION_LIMITS.maximumCursorBytes,
  historicalSourceIdentityBytes:
    AGUI_PRESENTATION_AUTHORITY_LIMITS.streamIdentities * AGUI_PRESENTATION_LIMITS.maximumIdBytes,
});

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const cursorPattern = /^(?=.*[A-Za-z._~-])[A-Za-z0-9._~-]+$/u;
const dateTimePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/u;
const canonicalUtcMsPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const uint64Maximum = 18_446_744_073_709_551_615n;

const idSchema = z.string().min(1).max(128).regex(idPattern);
const cursorSchema = z.string().min(16).max(2_048).regex(cursorPattern);
const dateTimeSchema = z.string().min(20).max(35).regex(dateTimePattern).refine(
  (value) => Number.isFinite(Date.parse(value)),
  "invalid timestamp",
);
const canonicalUtcMsSchema = z.string().regex(canonicalUtcMsPattern).refine((value) => {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}, "invalid canonical UTC millisecond timestamp").brand<"AguiSnapshotCanonicalUtcMs">();
const uint64Schema = z.string().regex(uint64Pattern).refine(
  (value) => BigInt(value) <= uint64Maximum,
  "outside uint64",
);
const positiveUint64Schema = uint64Schema.refine((value) => value !== "0", "must be positive");
const timestampSchema = z.number().int().min(0).max(8_640_000_000_000_000);
const shortTextSchema = z.string().min(1).max(1_024);
const safeTextSchema = z.string().max(16_384);

export const aguiGrantBindingSchema = z.strictObject({
  sessionId: idSchema,
  sessionContractRevision: z.literal(SESSION_AGUI_CONTRACT_REVISION),
  presentationProfileRevision: z.literal(AGUI_PRESENTATION_PROFILE_REVISION),
  cursorProfileRevision: z.literal(AGUI_CURSOR_PROFILE_REVISION),
});

export type AguiGrantBinding = Readonly<z.infer<typeof aguiGrantBindingSchema>>;

export const aguiCursorBindingSchema = z.strictObject({
  cursor: cursorSchema,
  sessionId: idSchema,
  streamEpoch: positiveUint64Schema,
  durableSeq: uint64Schema,
  profileRevision: z.literal(AGUI_PRESENTATION_PROFILE_REVISION),
  cursorProfileRevision: z.literal(AGUI_CURSOR_PROFILE_REVISION),
});

export type AguiCursorBinding = Readonly<z.infer<typeof aguiCursorBindingSchema>>;

const aguiSnapshotAuthorityEnvelopeSchema = z.strictObject({
  authority: z.literal("session-browser-v3-http-snapshot"),
  hydrate: z.literal(true),
  repair: z.literal(true),
  profileRevision: z.literal(AGUI_PRESENTATION_PROFILE_REVISION),
  sessionId: idSchema,
  streamEpoch: positiveUint64Schema,
  durableSeq: uint64Schema,
  lastRecordedAt: canonicalUtcMsSchema.nullable(),
  cursor: cursorSchema,
  runBindings: z.array(z.unknown()).max(AGUI_PRESENTATION_AUTHORITY_LIMITS.runs),
  messageBindings: z.array(z.unknown()).max(AGUI_PRESENTATION_AUTHORITY_LIMITS.messages),
}).superRefine((snapshot, context) => {
  if ((snapshot.durableSeq === "0") !== (snapshot.lastRecordedAt === null)) {
    context.addIssue({ code: "custom", message: "durable head time" });
  }
});

type AguiSnapshotCanonicalUtcMs = z.infer<typeof canonicalUtcMsSchema>;

export type AguiPresentationSnapshotAuthority = Readonly<{
  authority: "session-browser-v3-http-snapshot";
  hydrate: true;
  repair: true;
  profileRevision: typeof AGUI_PRESENTATION_PROFILE_REVISION;
  sessionId: string;
  streamEpoch: string;
  durableSeq: string;
  lastRecordedAt: AguiSnapshotCanonicalUtcMs | null;
  cursor: string;
  runBindings: readonly AguiPresentationRunBinding[];
  messageBindings: readonly AguiPresentationMessageBinding[];
}>;

const runStartedSchema = z.strictObject({
  type: z.literal(EventType.RUN_STARTED),
  timestamp: timestampSchema,
  threadId: aguiPresentationThreadIdSchema,
  runId: aguiPresentationRunIdSchema,
  parentRunId: aguiPresentationRunIdSchema.optional(),
});
const runFinishedSchema = z.strictObject({
  type: z.literal(EventType.RUN_FINISHED),
  timestamp: timestampSchema,
  threadId: aguiPresentationThreadIdSchema,
  runId: aguiPresentationRunIdSchema,
});
const runErrorSchema = z.strictObject({
  type: z.literal(EventType.RUN_ERROR),
  timestamp: timestampSchema,
  message: safeTextSchema,
  code: idSchema,
});
const textStartSchema = z.strictObject({
  type: z.literal(EventType.TEXT_MESSAGE_START),
  timestamp: timestampSchema,
  messageId: aguiPresentationMessageIdSchema,
  role: z.literal("assistant"),
});
const textContentSchema = z.strictObject({
  type: z.literal(EventType.TEXT_MESSAGE_CONTENT),
  timestamp: timestampSchema,
  messageId: aguiPresentationMessageIdSchema,
  delta: z.string().min(1).max(16_384),
});
const textEndSchema = z.strictObject({
  type: z.literal(EventType.TEXT_MESSAGE_END),
  timestamp: timestampSchema,
  messageId: aguiPresentationMessageIdSchema,
});

const activityBase = {
  type: z.literal(EventType.ACTIVITY_SNAPSHOT),
  timestamp: timestampSchema,
  messageId: aguiPresentationMessageIdSchema,
  replace: z.literal(true),
} as const;
const safeSummaryActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.safe-summary.v1"),
  content: z.strictObject({
    partRef: idSchema,
    summary: safeTextSchema,
    status: z.enum(["streaming", "complete", "partial", "failed", "canceled"]),
  }),
});
const toolPreviewActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.tool-preview.v1"),
  content: z.strictObject({
    toolCallRef: idSchema,
    label: shortTextSchema,
    status: z.enum(["pending", "running", "awaiting-user", "completed", "failed", "canceled"]),
    summary: safeTextSchema.optional(),
    resultPreview: safeTextSchema.optional(),
    isError: z.boolean().optional(),
    truncated: z.boolean().optional(),
  }),
});
const hitlActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.hitl.v1"),
  content: z.strictObject({
    ownerRef: idSchema,
    expectedVersion: z.number().int().min(1),
    kind: z.enum(["approval", "interaction"]),
    title: shortTextSchema,
    description: safeTextSchema,
    allowedActions: z.array(idSchema).min(1).max(16).refine((values) => new Set(values).size === values.length),
    status: z.enum(["pending", "accepted", "rejected", "expired", "canceled"]),
    deadline: dateTimeSchema.optional(),
    receiptRef: idSchema.optional(),
  }),
});
const planActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.plan.v1"),
  content: z.strictObject({
    planRef: idSchema,
    summary: safeTextSchema,
    status: z.enum(["proposed", "active", "completed", "failed", "canceled"]),
    steps: z.array(z.strictObject({
      stepRef: idSchema,
      label: shortTextSchema,
      status: z.enum(["pending", "in-progress", "completed", "failed", "canceled"]),
    })).max(256),
  }),
});
const subagentActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.subagent.v1"),
  content: z.strictObject({
    subagentRef: idSchema,
    status: z.enum(["pending", "running", "completed", "failed", "canceled"]),
    summary: safeTextSchema.optional(),
  }),
});
const mediaActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.media.v1"),
  content: z.strictObject({
    operationRef: idSchema,
    state: z.enum(["pending", "queued", "active", "finalizing", "completed", "partial", "failed", "canceled", "unknown"]),
    progressBps: z.number().int().min(0).max(10_000),
    summary: safeTextSchema.optional(),
  }),
});
const artifactActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.artifact.v1"),
  content: z.strictObject({
    artifactRef: idSchema,
    artifactVersionRef: idSchema,
    availability: z.enum(["processing", "ready", "restricted", "unavailable", "deleted"]),
    mediaClass: z.enum(["image", "audio", "video", "document", "other"]),
    title: shortTextSchema.optional(),
  }),
});
const costActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.cost.v1"),
  content: z.strictObject({
    costProjectionRef: idSchema,
    state: z.enum(["pending", "estimated", "final", "corrected", "unavailable"]),
    displayAmount: z.string().min(1).max(64).regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u).optional(),
    unit: idSchema.optional(),
    freshness: dateTimeSchema,
  }),
});
const noticeActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.notice.v1"),
  content: z.strictObject({
    noticeRef: idSchema,
    code: idSchema,
    message: safeTextSchema,
    severity: z.enum(["info", "warning"]),
    retryClass: z.enum(["never", "after-delay", "after-user-action", "reconcile-receipt"]).optional(),
  }),
});
const errorActivitySchema = z.strictObject({
  ...activityBase,
  activityType: z.literal("kokoro.error.v1"),
  content: z.strictObject({
    errorRef: idSchema,
    code: idSchema,
    message: safeTextSchema,
    retryClass: z.enum(["never", "after-delay", "after-user-action", "reconcile-receipt"]),
    supportCorrelationRef: idSchema.optional(),
  }),
});

const activitySchema = z.union([
  safeSummaryActivitySchema,
  toolPreviewActivitySchema,
  hitlActivitySchema,
  planActivitySchema,
  subagentActivitySchema,
  mediaActivitySchema,
  artifactActivitySchema,
  costActivitySchema,
  noticeActivitySchema,
  errorActivitySchema,
]);

const sessionCustomSchema = z.strictObject({
  type: z.literal(EventType.CUSTOM),
  timestamp: timestampSchema,
  name: z.literal("kokoro.session.replace.v1"),
  value: z.strictObject({
    sessionId: idSchema,
    profileRevision: z.literal(AGUI_PRESENTATION_PROFILE_REVISION),
    title: shortTextSchema,
    lifecycle: z.enum(["active", "archived", "deleted"]),
    contextPolicy: z.enum(["standard", "temporary"]),
    activeBranchId: idSchema.nullable(),
    version: z.number().int().min(1),
  }),
});
const branchCustomSchema = z.strictObject({
  type: z.literal(EventType.CUSTOM),
  timestamp: timestampSchema,
  name: z.literal("kokoro.branch.replace.v1"),
  value: z.strictObject({
    branchId: idSchema,
    parentBranchId: idSchema.optional(),
    rootMessageId: aguiPresentationMessageIdSchema.nullable(),
    leafMessageId: aguiPresentationMessageIdSchema.nullable(),
    version: z.number().int().min(1),
  }),
});
const messageCustomSchema = z.strictObject({
  type: z.literal(EventType.CUSTOM),
  timestamp: timestampSchema,
  name: z.literal("kokoro.message.replace.v1"),
  value: z.strictObject({
    presentationMessageId: aguiPresentationMessageIdSchema,
    role: z.enum(["user", "assistant", "system"]),
    lifecycle: z.enum(["created", "streaming", "completed", "partial", "failed", "canceled"]),
    parentPresentationMessageId: aguiPresentationMessageIdSchema.nullable(),
    ordinal: z.number().int().min(0),
    version: z.number().int().min(1),
  }),
});
const runCustomSchema = z.strictObject({
  type: z.literal(EventType.CUSTOM),
  timestamp: timestampSchema,
  name: z.literal("kokoro.run.replace.v1"),
  value: z.strictObject({
    presentationRunId: aguiPresentationRunIdSchema,
    state: z.enum(["starting", "running", "waiting", "canceling", "finished", "error"]),
    ownerVersion: positiveUint64Schema,
  }),
});
const controlCustomSchema = z.strictObject({
  type: z.literal(EventType.CUSTOM),
  timestamp: timestampSchema,
  name: z.literal("kokoro.control.replace.v1"),
  value: z.strictObject({
    controlRef: idSchema,
    kind: z.enum(["approval", "interaction", "plan", "cancellation"]),
    state: z.enum(["pending", "accepted", "rejected", "expired", "canceled"]),
    expectedVersion: z.number().int().min(1),
    allowedActions: z.array(idSchema).max(16).refine((values) => new Set(values).size === values.length),
  }),
});
const receiptCustomSchema = z.strictObject({
  type: z.literal(EventType.CUSTOM),
  timestamp: timestampSchema,
  name: z.literal("kokoro.receipt.replace.v1"),
  value: z.strictObject({
    receiptRef: idSchema,
    commandId: idSchema,
    operation: idSchema,
    state: z.enum(["pending", "accepted", "committed", "rejected", "unknown"]),
    version: z.number().int().min(1),
  }),
});
const customSchema = z.union([
  sessionCustomSchema,
  branchCustomSchema,
  messageCustomSchema,
  runCustomSchema,
  controlCustomSchema,
  receiptCustomSchema,
]);

export const aguiPresentationEventSchema = z.union([
  runStartedSchema,
  runFinishedSchema,
  runErrorSchema,
  textStartSchema,
  textContentSchema,
  textEndSchema,
  activitySchema,
  customSchema,
]);

export type AguiPresentationEvent = Readonly<z.infer<typeof aguiPresentationEventSchema>>;
export type AguiActivityEvent = Extract<AguiPresentationEvent, { readonly type: "ACTIVITY_SNAPSHOT" }>;
export type AguiCustomEvent = Extract<AguiPresentationEvent, { readonly type: "CUSTOM" }>;

const sourceSchema = z.strictObject({
  sourceEventId: aguiPublicSourceEventIdSchema,
  sourceKind: idSchema,
  sessionId: idSchema,
  streamEpoch: positiveUint64Schema,
  durableSeq: positiveUint64Schema,
  projectionVersion: positiveUint64Schema,
  schemaRevision: z.literal(1),
  recordedAt: dateTimeSchema,
});

const projectionEnvelopeSchema = z.strictObject({
  profileRevision: z.literal(AGUI_PRESENTATION_PROFILE_REVISION),
  source: sourceSchema,
  presentationRunBindingRef: aguiPresentationRunBindingRefSchema.optional(),
  presentationMessageBindingRef: aguiPresentationMessageBindingRefSchema.optional(),
  bindingAuthorityDelta: aguiPresentationBindingAuthorityDeltaSchema,
  event: z.unknown(),
});

const drainingSchema = z.strictObject({
  type: z.literal("stream.draining"),
  profileRevision: z.literal(AGUI_PRESENTATION_PROFILE_REVISION),
  sessionId: idSchema,
  streamEpoch: positiveUint64Schema,
  lastDurableCursor: cursorSchema,
  action: z.literal("retry-same-cursor"),
  retryAfterMs: z.number().int().min(0).max(30_000).optional(),
});

export type AguiSseFrame = Readonly<{
  id: string | null;
  event: string | null;
  data: string;
}>;

export type AguiDurableFrame = Readonly<{
  kind: "durable";
  id: SessionCursor;
  event: AguiPresentationEvent["type"];
  data: Readonly<{
    profileRevision: typeof AGUI_PRESENTATION_PROFILE_REVISION;
    source: Readonly<z.infer<typeof sourceSchema>>;
    presentationRunBindingRef?: AguiPresentationRunBindingRef;
    presentationMessageBindingRef?: AguiPresentationMessageBindingRef;
    bindingAuthorityDelta: AguiPresentationBindingAuthorityDelta;
    event: AguiPresentationEvent;
  }>;
  cursorBinding: AguiCursorBinding;
}>;

export type AguiDrainingFrame = Readonly<{
  kind: "control";
  id: null;
  event: "kokoro.stream.draining";
  data: Readonly<z.infer<typeof drainingSchema>>;
}>;

export type AguiDecodedFrame = AguiDurableFrame | AguiDrainingFrame | Readonly<{
  kind: "replay";
  frame: AguiDurableFrame;
}>;

export class AguiPresentationProtocolError extends Error {
  constructor(readonly code: string, detail = "") {
    super(detail.length === 0 ? code : `${code}: ${detail}`);
    this.name = "AguiPresentationProtocolError";
  }
}

function fail(code: string, detail = ""): never {
  throw new AguiPresentationProtocolError(code, detail);
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedUtf8ByteLength(value: string, maximum: number): number {
  let total = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) total += 1;
    else if (codeUnit <= 0x7ff) total += 2;
    else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        total += 4;
        index += 1;
      } else total += 3;
    } else total += 3;
    if (total > maximum) return maximum + 1;
  }
  return total;
}

function admitSseFrame(value: unknown): AguiSseFrame {
  try {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
      fail("agui_sse_frame_shape_invalid");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (
      keys.length !== 3 || keys.some((key) => typeof key !== "string") ||
      !keys.includes("id") || !keys.includes("event") || !keys.includes("data")
    ) fail("agui_sse_frame_shape_invalid");
    if ([descriptors.id, descriptors.event, descriptors.data].some(
      (descriptor) => descriptor === undefined || !Object.hasOwn(descriptor, "value"),
    )) fail("agui_sse_frame_shape_invalid");
    const id = descriptors.id?.value as unknown;
    const event = descriptors.event?.value as unknown;
    const data = descriptors.data?.value as unknown;
    if (
      (id !== null && typeof id !== "string") ||
      (event !== null && typeof event !== "string") ||
      typeof data !== "string"
    ) fail("agui_sse_frame_shape_invalid");

    let remaining = AGUI_PRESENTATION_LIMITS.maximumFrameBytes;
    for (const field of [id, event, data]) {
      if (field === null) continue;
      const fieldBytes = boundedUtf8ByteLength(field, remaining);
      if (fieldBytes > remaining) fail("agui_frame_limit_exceeded", "bytes");
      remaining -= fieldBytes;
    }
    return Object.freeze({ id, event, data });
  } catch (error) {
    if (error instanceof AguiPresentationProtocolError) throw error;
    fail("agui_sse_frame_shape_invalid");
  }
}

function sameSseFrame(left: AguiSseFrame, right: AguiSseFrame): boolean {
  return left.id === right.id && left.event === right.event && left.data === right.data;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function assertJsonBudget(value: unknown): void {
  const stack: Array<Readonly<{ value: unknown; depth: number }>> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    nodes += 1;
    if (
      nodes > AGUI_PRESENTATION_LIMITS.maximumJsonNodes ||
      current.depth > AGUI_PRESENTATION_LIMITS.maximumJsonDepth
    ) fail("agui_frame_limit_exceeded", "shape");
    if (Array.isArray(current.value)) {
      if (current.value.length > AGUI_PRESENTATION_LIMITS.maximumArrayItems) {
        fail("agui_frame_limit_exceeded", "shape");
      }
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
    } else if (current.value !== null && typeof current.value === "object") {
      const values = Object.values(current.value);
      if (values.length > AGUI_PRESENTATION_LIMITS.maximumObjectKeys) {
        fail("agui_frame_limit_exceeded", "shape");
      }
      for (const child of values) stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function parseBoundedJson(frame: AguiSseFrame): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data) as unknown;
  } catch {
    fail("agui_frame_json_invalid");
  }
  assertJsonBudget(parsed);
  return parsed;
}

const snapshotAuthorityKeys = new Set([
  "authority",
  "hydrate",
  "repair",
  "profileRevision",
  "sessionId",
  "streamEpoch",
  "durableSeq",
  "lastRecordedAt",
  "cursor",
  "runBindings",
  "messageBindings",
]);

const maximumSnapshotAuthorityNodes =
  64 +
  AGUI_PRESENTATION_AUTHORITY_LIMITS.runs * 20 +
  AGUI_PRESENTATION_AUTHORITY_LIMITS.messages * 15;

function descriptorSafeJsonClone(
  value: unknown,
  budget: { remaining: number } = { remaining: maximumSnapshotAuthorityNodes },
  depth = 0,
): unknown {
  budget.remaining -= 1;
  if (budget.remaining < 0) fail("agui_authority_capacity_exceeded");
  if (value === null || ["string", "number", "boolean", "undefined"].includes(typeof value)) return value;
  if (typeof value !== "object" || depth > 6) fail("agui_snapshot_authority_invalid");
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail("agui_snapshot_authority_invalid");
    const length = Reflect.getOwnPropertyDescriptor(value, "length")?.value as unknown;
    if (!Number.isInteger(length) || (length as number) < 0) fail("agui_snapshot_authority_invalid");
    if ((length as number) > AGUI_PRESENTATION_AUTHORITY_LIMITS.messages) {
      fail("agui_authority_capacity_exceeded");
    }
    const keys = Reflect.ownKeys(value);
    const keySet = new Set(keys);
    if (
      keys.some((key) => typeof key !== "string") ||
      keys.length !== (length as number) + 1 ||
      Array.from({ length: length as number }, (_, index) => String(index)).some((key) => !keySet.has(key))
    ) fail("agui_snapshot_authority_invalid");
    return Array.from({ length: length as number }, (_, index) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        fail("agui_snapshot_authority_invalid");
      }
      return descriptorSafeJsonClone(descriptor.value, budget, depth + 1);
    });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail("agui_snapshot_authority_invalid");
  const keys = Reflect.ownKeys(value);
  if (keys.length > 32 || keys.some((key) => typeof key !== "string")) {
    fail("agui_snapshot_authority_invalid");
  }
  const clone: Record<string, unknown> = {};
  for (const key of keys as string[]) {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
      fail("agui_snapshot_authority_invalid");
    }
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      value: descriptorSafeJsonClone(descriptor.value, budget, depth + 1),
      writable: true,
    });
  }
  return clone;
}

function admitSnapshotAuthority(
  value: unknown,
  limits: Readonly<{ runs: number; messages: number }>,
): unknown {
  try {
    if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
      fail("agui_snapshot_authority_invalid");
    }
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== snapshotAuthorityKeys.size || keys.some((key) => typeof key !== "string") ||
      keys.some((key) => typeof key === "string" && !snapshotAuthorityKeys.has(key))
    ) fail("agui_snapshot_authority_invalid");
    const descriptors = new Map<string, PropertyDescriptor>();
    for (const key of keys as string[]) {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !Object.hasOwn(descriptor, "value")) {
        fail("agui_snapshot_authority_invalid");
      }
      descriptors.set(key, descriptor);
    }
    for (const [field, maximum] of [["runBindings", limits.runs], ["messageBindings", limits.messages]] as const) {
      const bindings = descriptors.get(field)?.value as unknown;
      if (!Array.isArray(bindings) || Object.getPrototypeOf(bindings) !== Array.prototype) {
        fail("agui_snapshot_authority_invalid");
      }
      const length = Object.getOwnPropertyDescriptor(bindings, "length")?.value as unknown;
      if (!Number.isInteger(length) || (length as number) < 0 || (length as number) > maximum) {
        fail("agui_authority_capacity_exceeded");
      }
    }
    return descriptorSafeJsonClone(value);
  } catch (error) {
    if (error instanceof AguiPresentationProtocolError) throw error;
    fail("agui_snapshot_authority_invalid");
  }
}

type BindingDeltaKind = AguiPresentationBindingAuthorityDelta["kind"];
type SourceMapping = Readonly<{
  type: AguiPresentationEvent["type"];
  bindingAuthorityDeltaKind: BindingDeltaKind;
  discriminator?: string;
}>;

const sourceMappings = new Map<string, SourceMapping>([
  ["presentation.run.started", { type: EventType.RUN_STARTED, bindingAuthorityDeltaKind: "run.replace" }],
  ["presentation.run.finished", { type: EventType.RUN_FINISHED, bindingAuthorityDeltaKind: "run.replace" }],
  ["presentation.run.error", { type: EventType.RUN_ERROR, bindingAuthorityDeltaKind: "run.replace" }],
  ["presentation.message.text.started", { type: EventType.TEXT_MESSAGE_START, bindingAuthorityDeltaKind: "message.replace" }],
  ["presentation.message.text.content", { type: EventType.TEXT_MESSAGE_CONTENT, bindingAuthorityDeltaKind: "none" }],
  ["presentation.message.text.ended", { type: EventType.TEXT_MESSAGE_END, bindingAuthorityDeltaKind: "message.replace" }],
  ["presentation.activity.safe-summary", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.safe-summary.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.tool-preview", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.tool-preview.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.hitl", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.hitl.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.plan", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.plan.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.subagent", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.subagent.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.media", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.media.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.artifact", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.artifact.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.cost", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.cost.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.notice", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.notice.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.activity.error", { type: EventType.ACTIVITY_SNAPSHOT, discriminator: "kokoro.error.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.custom.session", { type: EventType.CUSTOM, discriminator: "kokoro.session.replace.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.custom.branch", { type: EventType.CUSTOM, discriminator: "kokoro.branch.replace.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.custom.message", { type: EventType.CUSTOM, discriminator: "kokoro.message.replace.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.custom.run", { type: EventType.CUSTOM, discriminator: "kokoro.run.replace.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.custom.control", { type: EventType.CUSTOM, discriminator: "kokoro.control.replace.v1", bindingAuthorityDeltaKind: "none" }],
  ["presentation.custom.receipt", { type: EventType.CUSTOM, discriminator: "kokoro.receipt.replace.v1", bindingAuthorityDeltaKind: "none" }],
]);

const allowedEventFields = new Map<string, ReadonlySet<string>>([
  [EventType.RUN_STARTED, new Set(["type", "timestamp", "threadId", "runId", "parentRunId"])],
  [EventType.RUN_FINISHED, new Set(["type", "timestamp", "threadId", "runId"])],
  [EventType.RUN_ERROR, new Set(["type", "timestamp", "message", "code"])],
  [EventType.TEXT_MESSAGE_START, new Set(["type", "timestamp", "messageId", "role"])],
  [EventType.TEXT_MESSAGE_CONTENT, new Set(["type", "timestamp", "messageId", "delta"])],
  [EventType.TEXT_MESSAGE_END, new Set(["type", "timestamp", "messageId"])],
  [EventType.ACTIVITY_SNAPSHOT, new Set(["type", "timestamp", "messageId", "activityType", "content", "replace"])],
  [EventType.CUSTOM, new Set(["type", "timestamp", "name", "value"])],
]);
const allowedActivityTypes = new Set([
  "kokoro.safe-summary.v1",
  "kokoro.tool-preview.v1",
  "kokoro.hitl.v1",
  "kokoro.plan.v1",
  "kokoro.subagent.v1",
  "kokoro.media.v1",
  "kokoro.artifact.v1",
  "kokoro.cost.v1",
  "kokoro.notice.v1",
  "kokoro.error.v1",
]);
const allowedCustomNames = new Set([
  "kokoro.session.replace.v1",
  "kokoro.branch.replace.v1",
  "kokoro.message.replace.v1",
  "kokoro.run.replace.v1",
  "kokoro.control.replace.v1",
  "kokoro.receipt.replace.v1",
]);
const forbiddenReasoningKey = /^(?:chain[_-]?of[_-]?thought|cot|private[_-]?reasoning|hidden[_-]?reasoning|reasoning[_-]?(?:content|trace|tokens))$/iu;
const forbiddenToolKey = /^(?:api[_-]?key|authorization|credential|headers?|password|private[_-]?key|provider[_-]?url|raw[_-]?(?:input|output|result)|secret|token|args|arguments|input)$/iu;
const forbiddenBrowserInternalRouteKey = /^(?:internalRunRef|internalMessageRef|parentInternalRunRef)$/u;

function containsKey(value: unknown, pattern: RegExp): boolean {
  if (Array.isArray(value)) return value.some((entry) => containsKey(entry, pattern));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => pattern.test(key) || containsKey(child, pattern));
}

function validateClosedEventPreSchema(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("agui_event_shape_invalid");
  const event = value as Record<string, unknown>;
  if (Object.hasOwn(event, "rawEvent")) fail("agui_raw_event_forbidden");
  if (containsKey(event, forbiddenReasoningKey)) fail("agui_cot_forbidden");
  if (typeof event.type !== "string" || !allowedEventFields.has(event.type)) {
    fail("agui_event_type_forbidden", String(event.type));
  }
  if (event.type === EventType.CUSTOM && (typeof event.name !== "string" || !allowedCustomNames.has(event.name))) {
    fail("agui_unknown_custom", String(event.name));
  }
  if (event.type === EventType.CUSTOM && event.name === "kokoro.run.replace.v1") {
    const owner = event.value;
    if (
      owner === null || typeof owner !== "object" || Array.isArray(owner) ||
      Object.hasOwn(owner, "projectionVersion") || !Object.hasOwn(owner, "ownerVersion") ||
      !positiveUint64Schema.safeParse((owner as Record<string, unknown>)["ownerVersion"]).success
    ) fail("agui_custom_run_owner_version_invalid");
  }
  if (
    event.type === EventType.ACTIVITY_SNAPSHOT &&
    (typeof event.activityType !== "string" || !allowedActivityTypes.has(event.activityType))
  ) fail("agui_unknown_activity", String(event.activityType));
  if (
    event.type === EventType.ACTIVITY_SNAPSHOT &&
    event.activityType === "kokoro.tool-preview.v1" &&
    containsKey(event.content, forbiddenToolKey)
  ) fail("agui_tool_secret_forbidden");
  const fields = allowedEventFields.get(event.type);
  const extra = Object.keys(event).find((field) => !fields?.has(field));
  if (extra !== undefined) fail("agui_event_extra_forbidden", extra);
}

function validateBrowserEnvelopePreSchema(value: unknown): void {
  if (containsKey(value, forbiddenBrowserInternalRouteKey)) {
    fail("agui_browser_internal_route_forbidden");
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const source = (value as Record<string, unknown>)["source"];
  if (source === null || typeof source !== "object" || Array.isArray(source)) return;
  const sourceRecord = source as Record<string, unknown>;
  const sourceEventId = sourceRecord["sourceEventId"];
  if (typeof sourceEventId !== "string") return;
  if (!aguiPublicSourceEventIdSchema.safeParse(sourceEventId).success) {
    fail("agui_public_source_event_id_invalid");
  }
  const { sessionId, streamEpoch, durableSeq } = sourceRecord;
  if (
    typeof sessionId === "string" && typeof streamEpoch === "string" && typeof durableSeq === "string" &&
    sourceEventId === `presentation.event:${sessionId}:${streamEpoch}:${durableSeq}`
  ) fail("agui_public_source_event_axes_exposed");
}

type RunAuthority = Readonly<{
  runId: string;
  threadId: string;
  state: "open" | "finished" | "error";
}>;
type MessageAuthority = Readonly<{
  messageId: string;
  runBindingRef: string;
  state: "open" | "ended";
}>;
type RunProjectionState = "starting" | "running" | "waiting" | "canceling" | "finished" | "error";
type RunProjectionOwner = Readonly<{
  runBindingRef: string;
  runId: string;
  version: string;
  state: RunProjectionState;
  fingerprint: string;
}>;
type MessageProjectionLifecycle = "created" | "streaming" | "completed" | "partial" | "failed" | "canceled";
type MessageProjectionOwner = Readonly<{
  runBindingRef: string;
  messageBindingRef: string;
  messageId: string;
  role: "user" | "assistant" | "system";
  parentPresentationMessageId: string | null;
  ordinal: number;
  version: number;
  lifecycle: MessageProjectionLifecycle;
  fingerprint: string;
}>;

type AguiDecoderState = Readonly<{
  cursorBinding: AguiCursorBinding;
  lastRecordedAt: number;
  lastDecoded?: AguiDurableFrame;
  lastCommittedFrame?: AguiSseFrame;
  presentationThreadId?: string;
  seenCursors: ReadonlySet<string>;
  sourceEventIds: ReadonlySet<string>;
  runs: ReadonlyMap<string, RunAuthority>;
  runIds: ReadonlyMap<string, string>;
  messages: ReadonlyMap<string, MessageAuthority>;
  messageIds: ReadonlyMap<string, string>;
  trustedRuns: ReadonlyMap<string, AguiPresentationRunBinding>;
  trustedMessages: ReadonlyMap<string, AguiPresentationMessageBinding>;
  runProjectionOwners: ReadonlyMap<string, RunProjectionOwner>;
  messageProjectionOwners: ReadonlyMap<string, MessageProjectionOwner>;
}>;

export type AguiDispatchAcknowledgement = "applied" | "replayed";

export type AguiPreparedFrame = Readonly<{
  decoded: AguiDecodedFrame;
  commit(acknowledgement: AguiDispatchAcknowledgement): void;
}>;

export type AguiPresentationDecoder = Readonly<{
  prepare(frame: AguiSseFrame): AguiPreparedFrame;
  getResumeRequest(): Readonly<{
    headers: Readonly<Record<typeof LAST_EVENT_ID_HEADER, string>>;
    queryCursor: string;
    cursorBinding: AguiCursorBinding;
  }>;
}>;

const aguiPresentationSnapshotReadersForTesting = new WeakMap<
  AguiPresentationDecoder,
  () => AguiPresentationSnapshotAuthority
>();

/** Internal test inspector. Deliberately absent from the public package façade. */
export function readAguiPresentationSnapshotForTesting(
  decoder: AguiPresentationDecoder,
): AguiPresentationSnapshotAuthority {
  const read = aguiPresentationSnapshotReadersForTesting.get(decoder);
  if (read === undefined) throw new Error("Unknown AG-UI presentation decoder");
  return read();
}

function assertCommitAcknowledgement(acknowledgement: AguiDispatchAcknowledgement): void {
  if (acknowledgement !== "applied" && acknowledgement !== "replayed") {
    fail("agui_dispatch_ack_invalid");
  }
}

function assertOwnerVersion(
  kind: "run" | "message",
  currentVersion: string | number | undefined,
  nextVersion: string | number,
  currentFingerprint: string | undefined,
  nextFingerprint: string,
): "replay" | "advance" {
  if (currentVersion === undefined) return "advance";
  const current = typeof currentVersion === "string" ? BigInt(currentVersion) : BigInt(currentVersion);
  const next = typeof nextVersion === "string" ? BigInt(nextVersion) : BigInt(nextVersion);
  if (next < current) fail(`agui_${kind}_owner_version_regression`);
  if (next === current) {
    if (currentFingerprint !== nextFingerprint) fail(`agui_${kind}_owner_same_version_conflict`);
    return "replay";
  }
  if (next !== current + 1n) fail(`agui_${kind}_owner_version_gap`);
  return "advance";
}

const runProjectionTransitions: Readonly<Record<RunProjectionState, ReadonlySet<RunProjectionState>>> = {
  starting: new Set(["starting", "running", "waiting", "canceling", "finished", "error"]),
  running: new Set(["running", "waiting", "canceling", "finished", "error"]),
  waiting: new Set(["waiting", "running", "canceling", "finished", "error"]),
  canceling: new Set(["canceling", "finished", "error"]),
  finished: new Set(["finished"]),
  error: new Set(["error"]),
};

const messageProjectionTransitions: Readonly<Record<MessageProjectionLifecycle, ReadonlySet<MessageProjectionLifecycle>>> = {
  created: new Set(["created", "streaming", "completed", "partial", "failed", "canceled"]),
  streaming: new Set(["streaming", "completed", "partial", "failed", "canceled"]),
  completed: new Set(["completed"]),
  partial: new Set(["partial"]),
  failed: new Set(["failed"]),
  canceled: new Set(["canceled"]),
};

function isRunProjectionTerminal(state: RunProjectionState): boolean {
  return state === "finished" || state === "error";
}

function isMessageProjectionTerminal(lifecycle: MessageProjectionLifecycle): boolean {
  return ["completed", "partial", "failed", "canceled"].includes(lifecycle);
}

function assertBindingShape(
  data: AguiDurableFrame["data"],
  runs: ReadonlyMap<string, RunAuthority>,
  messages: ReadonlyMap<string, MessageAuthority>,
): void {
  const event = data.event;
  const runRef = data.presentationRunBindingRef;
  const messageRef = data.presentationMessageBindingRef;
  if ([EventType.RUN_STARTED, EventType.RUN_FINISHED, EventType.RUN_ERROR].includes(event.type)) {
    if (runRef === undefined || messageRef !== undefined) fail("agui_frame_run_binding_invalid");
    return;
  }
  if ([EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END, EventType.ACTIVITY_SNAPSHOT].includes(event.type)) {
    if (runRef === undefined || messageRef === undefined) fail("agui_frame_message_binding_invalid");
    const messageId = "messageId" in event ? event.messageId : undefined;
    const message = messages.get(messageRef);
    if (message !== undefined && (message.runBindingRef !== runRef || message.messageId !== messageId)) {
      fail("agui_frame_message_binding_invalid");
    }
    return;
  }
  if (event.type !== EventType.CUSTOM) return;
  if (event.name === "kokoro.message.replace.v1") {
    const message = messageRef === undefined ? undefined : messages.get(messageRef);
    if (
      runRef === undefined || messageRef === undefined || message === undefined ||
      message.runBindingRef !== runRef || message.messageId !== event.value.presentationMessageId
    ) fail("agui_frame_message_binding_invalid");
  } else if (["kokoro.run.replace.v1", "kokoro.control.replace.v1", "kokoro.receipt.replace.v1"].includes(event.name)) {
    if (runRef === undefined || messageRef !== undefined || !runs.has(runRef)) fail("agui_frame_run_binding_invalid");
  } else if (runRef !== undefined || messageRef !== undefined) {
    fail("agui_frame_binding_unexpected");
  }
}

function assertTrustedSnapshotBinding(
  data: AguiDurableFrame["data"],
  trustedRuns: ReadonlyMap<string, AguiPresentationRunBinding>,
  trustedMessages: ReadonlyMap<string, AguiPresentationMessageBinding>,
): Readonly<{
  run?: AguiPresentationRunBinding;
  message?: AguiPresentationMessageBinding;
}> {
  const event = data.event;
  const runRef = data.presentationRunBindingRef;
  const messageRef = data.presentationMessageBindingRef;
  const messageBound = [
    EventType.TEXT_MESSAGE_START,
    EventType.TEXT_MESSAGE_CONTENT,
    EventType.TEXT_MESSAGE_END,
    EventType.ACTIVITY_SNAPSHOT,
  ].includes(event.type) || (event.type === EventType.CUSTOM && event.name === "kokoro.message.replace.v1");
  const runBound = messageBound || [
    EventType.RUN_STARTED,
    EventType.RUN_FINISHED,
    EventType.RUN_ERROR,
  ].includes(event.type) || (
    event.type === EventType.CUSTOM &&
    ["kokoro.run.replace.v1", "kokoro.control.replace.v1", "kokoro.receipt.replace.v1"].includes(event.name)
  );

  if (!runBound) {
    if (runRef !== undefined || messageRef !== undefined) fail("agui_frame_binding_unexpected");
    return Object.freeze({});
  }
  if (runRef === undefined) {
    fail(messageBound ? "agui_frame_message_binding_invalid" : "agui_frame_run_binding_invalid");
  }
  if (!messageBound && messageRef !== undefined) fail("agui_frame_run_binding_invalid");
  const run = trustedRuns.get(runRef);
  if (run === undefined) fail("agui_run_binding_authority_missing", runRef);

  let message: AguiPresentationMessageBinding | undefined;
  if (messageBound) {
    if (messageRef === undefined) fail("agui_frame_message_binding_invalid");
    message = trustedMessages.get(messageRef);
    if (message === undefined) fail("agui_message_binding_authority_missing", messageRef);
    if (message.presentationRunBindingRef !== runRef) fail("agui_frame_message_binding_invalid");
  }

  return Object.freeze({ run, ...(message === undefined ? {} : { message }) });
}

function assertTrustedSnapshotBindingEvidence(
  data: AguiDurableFrame["data"],
  trusted: Readonly<{
    run?: AguiPresentationRunBinding;
    message?: AguiPresentationMessageBinding;
  }>,
): void {
  const event = data.event;
  const runRef = data.presentationRunBindingRef;
  const run = trusted.run;
  const message = trusted.message;

  if (run !== undefined && event.type === EventType.RUN_STARTED) {
    if (
      event.runId !== run.presentationRunId || event.threadId !== run.presentationThreadId ||
      (event.parentRunId ?? null) !== run.parentLineage.parentPresentationRunId ||
      data.source.sourceEventId !== run.openedBySourceEventId || data.source.recordedAt !== run.openedAt
    ) fail("agui_run_start_binding_conflict", run.bindingRef);
  } else if (run !== undefined && (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR)) {
    const expectedState = event.type === EventType.RUN_FINISHED ? "finished" : "error";
    if (
      run.state !== expectedState || data.source.sourceEventId !== run.terminalSourceEventId ||
      data.source.recordedAt !== run.terminalAt ||
      (event.type === EventType.RUN_ERROR && run.terminalDisposition !== "error") ||
      (event.type === EventType.RUN_FINISHED && (
        event.runId !== run.presentationRunId || event.threadId !== run.presentationThreadId ||
        run.terminalDisposition === "error" || run.terminalDisposition === null
      ))
    ) fail("agui_run_terminal_binding_conflict", run.bindingRef);
  }

  if (message !== undefined) {
    if (
      runRef !== message.presentationRunBindingRef ||
      ("messageId" in event && event.messageId !== message.presentationMessageId) ||
      (event.type === EventType.CUSTOM && event.name === "kokoro.message.replace.v1" &&
        event.value.presentationMessageId !== message.presentationMessageId)
    ) fail("agui_frame_message_binding_invalid");
    if (
      event.type === EventType.TEXT_MESSAGE_START &&
      (data.source.sourceEventId !== message.openedBySourceEventId || data.source.recordedAt !== message.openedAt)
    ) fail("agui_message_open_source_conflict", message.bindingRef);
    if (
      event.type === EventType.TEXT_MESSAGE_END &&
      (
        message.state !== "ended" || data.source.sourceEventId !== message.endedBySourceEventId ||
        data.source.recordedAt !== message.endedAt
      )
    ) fail("agui_message_end_source_conflict", message.bindingRef);
    const recordedAt = Date.parse(data.source.recordedAt);
    if (
      recordedAt < Date.parse(message.openedAt) ||
      (message.endedAt !== null && recordedAt > Date.parse(message.endedAt))
    ) fail("agui_message_binding_time_invalid", message.bindingRef);
  }
}

function assertBindingDeltaScope(
  data: AguiDurableFrame["data"],
  binding: AguiPresentationRunBinding | AguiPresentationMessageBinding,
): void {
  if (binding.sessionId !== data.source.sessionId || binding.profileRevision !== data.profileRevision) {
    fail("agui_binding_delta_scope_conflict", binding.bindingRef);
  }
}

function applyBindingAuthorityDelta(
  data: AguiDurableFrame["data"],
  mapping: SourceMapping,
  runBindings: Map<string, AguiPresentationRunBinding>,
  messageBindings: Map<string, AguiPresentationMessageBinding>,
): void {
  const delta = data.bindingAuthorityDelta;
  if (delta.kind !== mapping.bindingAuthorityDeltaKind) {
    fail("agui_binding_delta_kind_invalid", data.source.sourceEventId);
  }
  if (delta.kind === "none") return;
  const event = data.event;

  if (delta.kind === "run.replace") {
    const binding = delta.binding;
    if (
      binding.bindingRef !== data.presentationRunBindingRef ||
      data.presentationMessageBindingRef !== undefined
    ) fail("agui_binding_delta_ref_conflict", binding.bindingRef);
    assertBindingDeltaScope(data, binding);
    if (
      (binding.state === "finished" && binding.terminalDisposition !== "success") ||
      (binding.state === "error" && binding.terminalDisposition !== "error")
    ) fail("agui_run_terminal_state_invalid", binding.bindingRef);
    const existing = runBindings.get(binding.bindingRef);
    if (event.type === EventType.RUN_STARTED) {
      if (existing !== undefined) fail("agui_binding_delta_run_duplicate", binding.bindingRef);
      if ([...runBindings.values()].some(({ presentationRunId }) => presentationRunId === binding.presentationRunId)) {
        fail("agui_binding_delta_run_duplicate", binding.bindingRef);
      }
      if (
        binding.terminalSourceEventId !== null &&
        binding.terminalSourceEventId !== data.source.sourceEventId
      ) fail("agui_binding_delta_future_evidence", binding.bindingRef);
      if (
        binding.state !== "open" || binding.terminalDisposition !== null ||
        binding.terminalSourceEventId !== null || binding.terminalAt !== null
      ) fail("agui_binding_delta_state_conflict", binding.bindingRef);
      if (binding.openedBySourceEventId !== data.source.sourceEventId) {
        fail("agui_binding_delta_source_conflict", binding.bindingRef);
      }
      if (binding.openedAt !== data.source.recordedAt) fail("agui_binding_delta_time_conflict", binding.bindingRef);
      if (
        binding.parentLineage.parentPresentationRunId !== null &&
        binding.parentLineage.parentPresentationRunId === binding.resumeOfPresentationRunId
      ) fail("agui_resume_parent_confused", binding.bindingRef);
      if (
        event.runId !== binding.presentationRunId || event.threadId !== binding.presentationThreadId ||
        (event.parentRunId ?? null) !== binding.parentLineage.parentPresentationRunId
      ) fail("agui_binding_delta_event_identity_conflict", binding.bindingRef);
      const parentId = binding.parentLineage.parentPresentationRunId;
      if (parentId !== null) {
        const parent = [...runBindings.values()].find(({ presentationRunId }) => presentationRunId === parentId);
        if (parent === undefined || parent.state === "open") {
          fail("agui_binding_delta_future_evidence", binding.bindingRef);
        }
      }
      if (binding.segmentOrdinal > 0) {
        const previous = binding.resumeOfPresentationRunId === null
          ? undefined
          : [...runBindings.values()].find(
            ({ presentationRunId }) => presentationRunId === binding.resumeOfPresentationRunId,
          );
        if (
          previous === undefined || previous.state === "open" ||
          previous.segmentOrdinal !== binding.segmentOrdinal - 1 ||
          previous.presentationThreadId !== binding.presentationThreadId ||
          stableStringify(previous.parentLineage) !== stableStringify(binding.parentLineage)
        ) fail("agui_binding_delta_future_evidence", binding.bindingRef);
      }
      runBindings.set(binding.bindingRef, binding);
      return;
    }
    if (event.type !== EventType.RUN_FINISHED && event.type !== EventType.RUN_ERROR) {
      fail("agui_binding_delta_kind_invalid", data.source.sourceEventId);
    }
    if (existing === undefined || existing.state !== "open") {
      fail("agui_binding_delta_terminal_without_open", binding.bindingRef);
    }
    const state = event.type === EventType.RUN_FINISHED ? "finished" : "error";
    const terminalDisposition = event.type === EventType.RUN_FINISHED ? "success" : "error";
    if (binding.terminalSourceEventId !== data.source.sourceEventId) {
      fail("agui_binding_delta_source_conflict", binding.bindingRef);
    }
    if (
      binding.terminalAt === null || !canonicalUtcMsSchema.safeParse(binding.terminalAt).success ||
      binding.terminalAt !== data.source.recordedAt
    ) fail("agui_binding_delta_time_conflict", binding.bindingRef);
    if (binding.state !== state || binding.terminalDisposition !== terminalDisposition) {
      fail("agui_binding_delta_state_conflict", binding.bindingRef);
    }
    if (
      event.type === EventType.RUN_FINISHED &&
      (event.runId !== binding.presentationRunId || event.threadId !== binding.presentationThreadId)
    ) fail("agui_binding_delta_event_identity_conflict", binding.bindingRef);
    if ([...messageBindings.values()].some(
      (message) => message.presentationRunBindingRef === binding.bindingRef && message.state === "open",
    )) fail("agui_run_message_open");
    const expected: AguiPresentationRunBinding = {
      ...existing,
      state,
      terminalDisposition,
      terminalSourceEventId: data.source.sourceEventId,
      terminalAt: data.source.recordedAt,
    };
    if (stableStringify(binding) !== stableStringify(expected)) {
      fail("agui_binding_delta_replacement_conflict", binding.bindingRef);
    }
    runBindings.set(binding.bindingRef, binding);
    return;
  }

  const binding = delta.binding;
  if (
    binding.bindingRef !== data.presentationMessageBindingRef ||
    binding.presentationRunBindingRef !== data.presentationRunBindingRef
  ) fail("agui_binding_delta_ref_conflict", binding.bindingRef);
  assertBindingDeltaScope(data, binding);
  const existing = messageBindings.get(binding.bindingRef);
  if (event.type === EventType.TEXT_MESSAGE_START) {
    const run = runBindings.get(binding.presentationRunBindingRef);
    if (run === undefined || run.state !== "open" || run.segmentOrdinal !== binding.resumeSegmentOrdinal) {
      fail("agui_binding_delta_future_evidence", binding.bindingRef);
    }
    if (existing !== undefined) fail("agui_binding_delta_message_duplicate", binding.bindingRef);
    if ([...messageBindings.values()].some(
      ({ presentationMessageId }) => presentationMessageId === binding.presentationMessageId,
    )) fail("agui_binding_delta_message_duplicate", binding.bindingRef);
    if (binding.state !== "open" || binding.endedBySourceEventId !== null || binding.endedAt !== null) {
      fail("agui_binding_delta_state_conflict", binding.bindingRef);
    }
    if (binding.openedBySourceEventId !== data.source.sourceEventId) {
      fail("agui_binding_delta_source_conflict", binding.bindingRef);
    }
    if (binding.openedAt !== data.source.recordedAt) fail("agui_binding_delta_time_conflict", binding.bindingRef);
    if (event.messageId !== binding.presentationMessageId) {
      fail("agui_binding_delta_event_identity_conflict", binding.bindingRef);
    }
    messageBindings.set(binding.bindingRef, binding);
    return;
  }
  if (event.type !== EventType.TEXT_MESSAGE_END) {
    fail("agui_binding_delta_kind_invalid", data.source.sourceEventId);
  }
  if (existing === undefined || existing.state !== "open") {
    fail("agui_binding_delta_message_end_without_open", binding.bindingRef);
  }
  if (binding.endedBySourceEventId !== data.source.sourceEventId) {
    fail("agui_binding_delta_source_conflict", binding.bindingRef);
  }
  if (
    binding.endedAt === null || !canonicalUtcMsSchema.safeParse(binding.endedAt).success ||
    binding.endedAt !== data.source.recordedAt
  ) fail("agui_binding_delta_time_conflict", binding.bindingRef);
  if (binding.state !== "ended") fail("agui_binding_delta_state_conflict", binding.bindingRef);
  if (event.messageId !== binding.presentationMessageId) {
    fail("agui_binding_delta_event_identity_conflict", binding.bindingRef);
  }
  const expected: AguiPresentationMessageBinding = {
    ...existing,
    state: "ended",
    endedBySourceEventId: data.source.sourceEventId,
    endedAt: data.source.recordedAt,
  };
  if (stableStringify(binding) !== stableStringify(expected)) {
    fail("agui_binding_delta_replacement_conflict", binding.bindingRef);
  }
  messageBindings.set(binding.bindingRef, binding);
}

function validateSnapshotAuthority(
  value: unknown,
  grant: AguiGrantBinding,
  limits: Readonly<{ streamIdentities: number; runs: number; messages: number }>,
): Readonly<{
  snapshot: AguiPresentationSnapshotAuthority;
  runRefs: ReadonlyMap<string, AguiPresentationRunBinding>;
  messageRefs: ReadonlyMap<string, AguiPresentationMessageBinding>;
  sourceEventIds: ReadonlySet<string>;
}> {
  const admitted = admitSnapshotAuthority(value, limits);
  const envelope = aguiSnapshotAuthorityEnvelopeSchema.safeParse(admitted);
  if (!envelope.success) fail("agui_snapshot_authority_invalid");
  if (
    envelope.data.sessionId !== grant.sessionId ||
    envelope.data.profileRevision !== grant.presentationProfileRevision
  ) fail("agui_snapshot_scope_conflict");
  if (envelope.data.runBindings.length > limits.runs || envelope.data.messageBindings.length > limits.messages) {
    fail("agui_authority_capacity_exceeded");
  }
  const durableSeq = BigInt(envelope.data.durableSeq);
  if (
    durableSeq === 0n &&
    (envelope.data.runBindings.length !== 0 || envelope.data.messageBindings.length !== 0)
  ) fail("agui_snapshot_zero_head_bindings_invalid");

  const runRefs = new Map<string, AguiPresentationRunBinding>();
  const runIds = new Map<string, AguiPresentationRunBinding>();
  const presentationThreadIds = new Set<string>();
  const bindingRefs = new Set<string>();
  const presentationIds = new Set<string>();
  const evidenceSourceIds = new Set<string>();
  let authorityRecordedAt = -1;
  for (const candidate of envelope.data.runBindings) {
    const parsed = aguiPresentationRunBindingSchema.safeParse(candidate);
    if (!parsed.success) fail("agui_run_binding_schema_invalid");
    const binding = parsed.data;
    if (binding.sessionId !== envelope.data.sessionId || binding.profileRevision !== envelope.data.profileRevision) {
      fail("agui_run_binding_scope_conflict", binding.bindingRef);
    }
    if (runRefs.has(binding.bindingRef) || runIds.has(binding.presentationRunId)) {
      fail("agui_run_binding_duplicate");
    }
    const openedTime = canonicalUtcMsSchema.safeParse(binding.openedAt);
    const terminalTime = canonicalUtcMsSchema.safeParse(binding.terminalAt ?? binding.openedAt);
    if (!openedTime.success || !terminalTime.success) {
      fail("agui_snapshot_binding_time_invalid", binding.bindingRef);
    }
    const openedAt = Date.parse(openedTime.data);
    const terminalAt = Date.parse(terminalTime.data);
    if (openedAt > terminalAt) {
      fail("agui_run_binding_time_invalid", binding.bindingRef);
    }
    if (
      (binding.state === "finished" && binding.terminalDisposition !== "success") ||
      (binding.state === "error" && binding.terminalDisposition !== "error")
    ) fail("agui_snapshot_terminal_state_invalid", binding.bindingRef);
    const knownThread = presentationThreadIds.has(binding.presentationThreadId);
    presentationThreadIds.add(binding.presentationThreadId);
    if (presentationThreadIds.size > 1) {
      fail("agui_snapshot_thread_scope_invalid");
    }
    if (bindingRefs.has(binding.bindingRef)) fail("agui_binding_identity_duplicate", binding.bindingRef);
    bindingRefs.add(binding.bindingRef);
    if (!knownThread) {
      if (presentationIds.has(binding.presentationThreadId)) {
        fail("agui_binding_identity_duplicate", binding.presentationThreadId);
      }
      presentationIds.add(binding.presentationThreadId);
    }
    if (presentationIds.has(binding.presentationRunId)) {
      fail("agui_binding_identity_duplicate", binding.presentationRunId);
    }
    presentationIds.add(binding.presentationRunId);
    authorityRecordedAt = Math.max(authorityRecordedAt, openedAt, terminalAt);
    for (const sourceId of [binding.openedBySourceEventId, binding.terminalSourceEventId]) {
      if (sourceId === null) continue;
      if (evidenceSourceIds.has(sourceId)) fail("agui_binding_source_identity_duplicate", sourceId);
      evidenceSourceIds.add(sourceId);
    }
    runRefs.set(binding.bindingRef, binding);
    runIds.set(binding.presentationRunId, binding);
  }

  for (const binding of runRefs.values()) {
    const parentPresentationRunId = binding.parentLineage.parentPresentationRunId;
    if (parentPresentationRunId === null) continue;
    if (parentPresentationRunId === binding.resumeOfPresentationRunId) {
      fail("agui_resume_parent_confused", binding.bindingRef);
    }
    const parent = runIds.get(parentPresentationRunId);
    if (parent === undefined || parent.bindingRef === binding.bindingRef) {
      fail("agui_parent_lineage_pair_invalid", binding.bindingRef);
    }
  }

  for (const binding of runRefs.values()) {
    const visited = new Set<string>();
    let current: AguiPresentationRunBinding | undefined = binding;
    while (current !== undefined) {
      if (visited.has(current.presentationRunId)) fail("agui_parent_lineage_cycle", binding.bindingRef);
      visited.add(current.presentationRunId);
      const parentId: string | null = current.parentLineage.parentPresentationRunId;
      current = parentId === null ? undefined : runIds.get(parentId);
    }
  }

  for (const binding of runRefs.values()) {
    const parentId = binding.parentLineage.parentPresentationRunId;
    if (parentId === null) continue;
    const parent = runIds.get(parentId);
    if (parent !== undefined && Date.parse(parent.openedAt) > Date.parse(binding.openedAt)) {
      fail("agui_parent_lineage_time_invalid", binding.bindingRef);
    }
  }

  for (const binding of runRefs.values()) {
    if (binding.segmentOrdinal === 0) continue;
    const previous = binding.resumeOfPresentationRunId === null
      ? undefined
      : runIds.get(binding.resumeOfPresentationRunId);
    if (
      previous === undefined || previous.state === "open" ||
      previous.segmentOrdinal !== binding.segmentOrdinal - 1 ||
      previous.presentationThreadId !== binding.presentationThreadId ||
      stableStringify(previous.parentLineage) !== stableStringify(binding.parentLineage) ||
      Date.parse(binding.openedAt) < Date.parse(previous.terminalAt ?? binding.openedAt)
    ) fail("agui_resume_parent_confused", binding.bindingRef);
  }

  const messageRefs = new Map<string, AguiPresentationMessageBinding>();
  const messageIds = new Set<string>();
  for (const candidate of envelope.data.messageBindings) {
    const parsed = aguiPresentationMessageBindingSchema.safeParse(candidate);
    if (!parsed.success) fail("agui_message_binding_schema_invalid");
    const binding = parsed.data;
    if (binding.sessionId !== envelope.data.sessionId || binding.profileRevision !== envelope.data.profileRevision) {
      fail("agui_message_binding_scope_conflict", binding.bindingRef);
    }
    const run = runRefs.get(binding.presentationRunBindingRef);
    if (run === undefined || run.segmentOrdinal !== binding.resumeSegmentOrdinal) {
      fail("agui_message_run_binding_invalid", binding.bindingRef);
    }
    if (messageRefs.has(binding.bindingRef) || messageIds.has(binding.presentationMessageId)) {
      fail("agui_message_binding_duplicate");
    }
    if (bindingRefs.has(binding.bindingRef)) fail("agui_binding_identity_duplicate", binding.bindingRef);
    bindingRefs.add(binding.bindingRef);
    if (presentationIds.has(binding.presentationMessageId)) {
      fail("agui_binding_identity_duplicate", binding.presentationMessageId);
    }
    presentationIds.add(binding.presentationMessageId);
    const openedTime = canonicalUtcMsSchema.safeParse(binding.openedAt);
    const endedTime = canonicalUtcMsSchema.safeParse(binding.endedAt ?? binding.openedAt);
    if (!openedTime.success || !endedTime.success) {
      fail("agui_snapshot_binding_time_invalid", binding.bindingRef);
    }
    const openedAt = Date.parse(openedTime.data);
    const endedAt = Date.parse(endedTime.data);
    if (openedAt > endedAt) {
      fail("agui_message_binding_time_invalid", binding.bindingRef);
    }
    const runOpenedAt = Date.parse(run.openedAt);
    const runTerminalAt = Date.parse(run.terminalAt ?? run.openedAt);
    if (run.terminalAt !== null && binding.endedAt === null) fail("agui_run_message_open", binding.bindingRef);
    if (openedAt < runOpenedAt) fail("agui_message_binding_time_invalid", binding.bindingRef);
    if (run.terminalAt !== null && endedAt > runTerminalAt) {
      fail("agui_message_binding_time_invalid", binding.bindingRef);
    }
    authorityRecordedAt = Math.max(authorityRecordedAt, openedAt, endedAt);
    for (const sourceId of [binding.openedBySourceEventId, binding.endedBySourceEventId]) {
      if (sourceId === null) continue;
      if (evidenceSourceIds.has(sourceId)) fail("agui_binding_source_identity_duplicate", sourceId);
      evidenceSourceIds.add(sourceId);
    }
    messageRefs.set(binding.bindingRef, binding);
    messageIds.add(binding.presentationMessageId);
  }

  if (BigInt(evidenceSourceIds.size) > durableSeq) {
    fail("agui_snapshot_binding_evidence_exceeds_head");
  }
  if (
    durableSeq !== 0n &&
    evidenceSourceIds.size >= limits.streamIdentities
  ) {
    fail("agui_authority_capacity_exceeded");
  }
  if (
    envelope.data.lastRecordedAt !== null &&
    authorityRecordedAt > Date.parse(envelope.data.lastRecordedAt)
  ) fail("agui_snapshot_authority_invalid");

  const snapshot: AguiPresentationSnapshotAuthority = deepFreeze({
    ...envelope.data,
    runBindings: [...runRefs.values()],
    messageBindings: [...messageRefs.values()],
  });
  return Object.freeze({
    snapshot,
    runRefs,
    messageRefs,
    sourceEventIds: evidenceSourceIds,
  });
}

function createAguiPresentationDecoderInternal(options: Readonly<{
  grant: AguiGrantBinding;
  snapshotAuthority: unknown;
  limits?: Readonly<{
    streamIdentities?: number;
    runs?: number;
    messages?: number;
  }>;
}>): AguiPresentationDecoder {
  const parsedGrant = aguiGrantBindingSchema.safeParse(options.grant);
  if (!parsedGrant.success) fail("agui_grant_profile_binding_invalid");
  const streamIdentityLimit = options.limits?.streamIdentities ?? AGUI_PRESENTATION_AUTHORITY_LIMITS.streamIdentities;
  const runLimit = options.limits?.runs ?? AGUI_PRESENTATION_AUTHORITY_LIMITS.runs;
  const messageLimit = options.limits?.messages ?? AGUI_PRESENTATION_AUTHORITY_LIMITS.messages;
  if (
    !Number.isInteger(streamIdentityLimit) || streamIdentityLimit < 2 ||
    streamIdentityLimit > AGUI_PRESENTATION_AUTHORITY_LIMITS.streamIdentities ||
    !Number.isInteger(runLimit) || runLimit < 1 || runLimit > AGUI_PRESENTATION_AUTHORITY_LIMITS.runs ||
    !Number.isInteger(messageLimit) || messageLimit < 1 || messageLimit > AGUI_PRESENTATION_AUTHORITY_LIMITS.messages
  ) fail("agui_authority_limit_invalid");

  if (!("snapshotAuthority" in options)) fail("agui_snapshot_authority_required");
  const snapshotValidation = validateSnapshotAuthority(
    options.snapshotAuthority,
    parsedGrant.data,
    { streamIdentities: streamIdentityLimit, runs: runLimit, messages: messageLimit },
  );
  const snapshot = snapshotValidation.snapshot;

  const initialCursorBinding: AguiCursorBinding = Object.freeze({
    cursor: snapshot.cursor,
    sessionId: snapshot.sessionId,
    streamEpoch: snapshot.streamEpoch,
    durableSeq: snapshot.durableSeq,
    profileRevision: snapshot.profileRevision,
    cursorProfileRevision: parsedGrant.data.cursorProfileRevision,
  });
  const resumesFromSnapshot = BigInt(snapshot.durableSeq) !== 0n;
  const initialRuns = new Map<string, RunAuthority>();
  const initialRunIds = new Map<string, string>();
  const initialMessages = new Map<string, MessageAuthority>();
  const initialMessageIds = new Map<string, string>();
  const initialTrustedRuns = new Map(snapshotValidation.runRefs);
  const initialTrustedMessages = new Map(snapshotValidation.messageRefs);
  let initialPresentationThreadId: string | undefined;
  let pending: Readonly<{ frame: AguiSseFrame; prepared: AguiPreparedFrame }> | undefined;

  if (resumesFromSnapshot) {
    for (const binding of initialTrustedRuns.values()) {
      initialRuns.set(binding.bindingRef, {
        runId: binding.presentationRunId,
        threadId: binding.presentationThreadId,
        state: binding.state,
      });
      initialRunIds.set(binding.presentationRunId, binding.bindingRef);
      initialPresentationThreadId ??= binding.presentationThreadId;
    }
    for (const binding of initialTrustedMessages.values()) {
      initialMessages.set(binding.bindingRef, {
        messageId: binding.presentationMessageId,
        runBindingRef: binding.presentationRunBindingRef,
        state: binding.state,
      });
      initialMessageIds.set(binding.presentationMessageId, binding.bindingRef);
    }
  }

  let state: AguiDecoderState = Object.freeze({
    cursorBinding: initialCursorBinding,
    lastRecordedAt: snapshot.lastRecordedAt === null ? -1 : Date.parse(snapshot.lastRecordedAt),
    ...(initialPresentationThreadId === undefined ? {} : { presentationThreadId: initialPresentationThreadId }),
    seenCursors: new Set<string>([initialCursorBinding.cursor]),
    sourceEventIds: new Set<string>(resumesFromSnapshot ? snapshotValidation.sourceEventIds : []),
    runs: initialRuns,
    runIds: initialRunIds,
    messages: initialMessages,
    messageIds: initialMessageIds,
    trustedRuns: initialTrustedRuns,
    trustedMessages: initialTrustedMessages,
    runProjectionOwners: new Map<string, RunProjectionOwner>(),
    messageProjectionOwners: new Map<string, MessageProjectionOwner>(),
  });

  const settled = (decoded: AguiDecodedFrame): AguiPreparedFrame => Object.freeze({
    decoded,
    commit(acknowledgement) {
      assertCommitAcknowledgement(acknowledgement);
    },
  });

  const prepare = (candidate: AguiSseFrame): AguiPreparedFrame => {
    const currentState = state;
    const {
      cursorBinding,
      lastRecordedAt,
      lastDecoded,
      lastCommittedFrame,
      presentationThreadId,
      seenCursors,
      sourceEventIds,
      runs,
      runIds,
      messages,
      messageIds,
      trustedRuns,
      trustedMessages,
      runProjectionOwners,
      messageProjectionOwners,
    } = currentState;
    const frame = admitSseFrame(candidate);
    if (pending !== undefined) {
      if (sameSseFrame(pending.frame, frame)) return pending.prepared;
      fail("agui_admission_pending");
    }
    const raw = parseBoundedJson(frame);
    if (frame.event === "kokoro.stream.draining") {
      if (frame.id !== null) fail("agui_draining_not_nondurable");
      const parsed = drainingSchema.safeParse(raw);
      if (!parsed.success) fail("agui_draining_shape_invalid");
      if (
        parsed.data.sessionId !== parsedGrant.data.sessionId ||
        parsed.data.streamEpoch !== cursorBinding.streamEpoch ||
        parsed.data.lastDurableCursor !== cursorBinding.cursor
      ) fail("agui_draining_cursor_conflict");
      return settled(deepFreeze({ kind: "control", id: null, event: "kokoro.stream.draining", data: parsed.data }));
    }

    if (frame.id === null || frame.event === null) fail("agui_durable_sse_identity_missing");
    const durableCursor = frame.id;
    if (bytes(durableCursor) > AGUI_PRESENTATION_LIMITS.maximumCursorBytes || !cursorSchema.safeParse(durableCursor).success) {
      fail("agui_cursor_invalid");
    }
    if (seenCursors.has(durableCursor)) {
      if (lastCommittedFrame !== undefined && sameSseFrame(lastCommittedFrame, frame) && lastDecoded?.id === durableCursor) {
        return settled(Object.freeze({ kind: "replay", frame: lastDecoded }));
      }
      fail("agui_stream_identity_duplicate");
    }

    validateBrowserEnvelopePreSchema(raw);
    const envelope = projectionEnvelopeSchema.safeParse(raw);
    if (!envelope.success) fail("agui_projection_payload_invalid");
    validateClosedEventPreSchema(envelope.data.event);
    const strictEvent = aguiPresentationEventSchema.safeParse(envelope.data.event);
    if (!strictEvent.success) fail("agui_event_shape_invalid");
    if (bytes(JSON.stringify(strictEvent.data)) > AGUI_PRESENTATION_LIMITS.maximumEventBytes) {
      fail("agui_event_limit_exceeded");
    }
    if (!EventSchemas.safeParse(strictEvent.data).success) fail("agui_official_event_schema_invalid");

    const data: AguiDurableFrame["data"] = deepFreeze({
      ...envelope.data,
      event: strictEvent.data,
    });
    if (frame.event !== data.event.type) fail("agui_sse_event_type_mismatch");
    const mapping = sourceMappings.get(data.source.sourceKind);
    const discriminator = data.event.type === EventType.ACTIVITY_SNAPSHOT
      ? data.event.activityType
      : data.event.type === EventType.CUSTOM ? data.event.name : undefined;
    if (mapping === undefined || mapping.type !== data.event.type) {
      fail("agui_closed_mapping_missing", data.source.sourceKind);
    }
    if (mapping.discriminator !== discriminator) {
      fail("agui_mapping_discriminator_conflict", data.source.sourceKind);
    }
    if (
      data.source.sessionId !== parsedGrant.data.sessionId ||
      data.source.streamEpoch !== cursorBinding.streamEpoch ||
      data.profileRevision !== parsedGrant.data.presentationProfileRevision
    ) fail("agui_stream_scope_conflict");
    const expectedSeq = BigInt(cursorBinding.durableSeq) + 1n;
    if (BigInt(data.source.durableSeq) !== expectedSeq) fail("agui_cursor_gap", data.source.durableSeq);
    const recordedAt = Date.parse(data.source.recordedAt);
    if (recordedAt !== data.event.timestamp || recordedAt < lastRecordedAt) fail("agui_event_time_invalid");
    if (sourceEventIds.has(data.source.sourceEventId)) fail("agui_stream_identity_duplicate");
    if (seenCursors.size >= streamIdentityLimit || sourceEventIds.size >= streamIdentityLimit) {
      fail("agui_authority_capacity_exceeded");
    }

    const event = data.event;
    const runRef = data.presentationRunBindingRef;
    const messageRef = data.presentationMessageBindingRef;
    if (event.type === EventType.RUN_STARTED && runRef !== undefined) {
      if (runs.has(runRef) || runIds.has(event.runId)) fail("agui_terminal_run_revived", event.runId);
    }
    if (event.type === EventType.TEXT_MESSAGE_START && messageRef !== undefined) {
      if (messages.has(messageRef) || messageIds.has(event.messageId)) fail("agui_message_reopened", event.messageId);
    }

    const nextTrustedRuns = new Map(trustedRuns);
    const nextTrustedMessages = new Map(trustedMessages);
    applyBindingAuthorityDelta(data, mapping, nextTrustedRuns, nextTrustedMessages);
    const trustedBinding = assertTrustedSnapshotBinding(data, nextTrustedRuns, nextTrustedMessages);
    assertBindingShape(data, runs, messages);
    let runUpdate: Readonly<{ ref: string; authority: RunAuthority }> | undefined;
    let messageUpdate: Readonly<{ ref: string; authority: MessageAuthority }> | undefined;
    let runProjectionUpdate: Readonly<{ ref: string; authority: RunProjectionOwner }> | undefined;
    let messageProjectionUpdate: Readonly<{ ref: string; authority: MessageProjectionOwner }> | undefined;

    if (event.type === EventType.RUN_STARTED) {
      if (runRef === undefined) fail("agui_frame_run_binding_invalid");
      if (runs.has(runRef) || runIds.has(event.runId)) fail("agui_terminal_run_revived", event.runId);
      if (presentationThreadId !== undefined && event.threadId !== presentationThreadId) {
        fail("agui_run_thread_scope_conflict");
      }
      if (
        event.parentRunId !== undefined &&
        (event.parentRunId === event.runId || !runIds.has(event.parentRunId))
      ) fail("agui_run_parent_lineage_conflict");
      if (runs.size >= runLimit || runIds.size >= runLimit) fail("agui_authority_capacity_exceeded");
      runUpdate = { ref: runRef, authority: { runId: event.runId, threadId: event.threadId, state: "open" } };
    } else if (event.type === EventType.RUN_FINISHED || event.type === EventType.RUN_ERROR) {
      if (runRef === undefined) fail("agui_frame_run_binding_invalid");
      const run = runs.get(runRef);
      if (run?.state !== "open") fail("agui_terminal_run_revived");
      if ([...messages.values()].some((message) => message.runBindingRef === runRef && message.state === "open")) {
        fail("agui_run_message_open");
      }
      if (event.type === EventType.RUN_FINISHED && (event.runId !== run.runId || event.threadId !== run.threadId)) {
        fail("agui_run_terminal_binding_conflict");
      }
      const terminalState = event.type === EventType.RUN_FINISHED ? "finished" : "error";
      const projectionOwner = runProjectionOwners.get(runRef);
      if (
        projectionOwner !== undefined && isRunProjectionTerminal(projectionOwner.state) &&
        projectionOwner.state !== terminalState
      ) fail("agui_run_owner_terminal_conflict");
      runUpdate = { ref: runRef, authority: { ...run, state: terminalState } };
    } else if (event.type === EventType.TEXT_MESSAGE_START) {
      const runOwner = runRef === undefined ? undefined : runProjectionOwners.get(runRef);
      if (
        runRef === undefined || messageRef === undefined || runs.get(runRef)?.state !== "open" ||
        (runOwner !== undefined && isRunProjectionTerminal(runOwner.state))
      ) {
        fail("agui_frame_message_binding_invalid");
      }
      if (messages.has(messageRef) || messageIds.has(event.messageId)) fail("agui_message_reopened", event.messageId);
      if (messages.size >= messageLimit || messageIds.size >= messageLimit) fail("agui_authority_capacity_exceeded");
      messageUpdate = { ref: messageRef, authority: { messageId: event.messageId, runBindingRef: runRef, state: "open" } };
    } else if (event.type === EventType.TEXT_MESSAGE_CONTENT || event.type === EventType.TEXT_MESSAGE_END) {
      const runOwner = runRef === undefined ? undefined : runProjectionOwners.get(runRef);
      if (runRef === undefined || messageRef === undefined) fail("agui_frame_message_binding_invalid");
      const message = messages.get(messageRef);
      if (message?.state !== "open" || message.messageId !== event.messageId) fail("agui_message_reopened", event.messageId);
      if (
        runs.get(runRef)?.state !== "open" ||
        (runOwner !== undefined && isRunProjectionTerminal(runOwner.state))
      ) fail("agui_frame_message_binding_invalid");
      const projectionOwner = messageProjectionOwners.get(messageRef);
      if (
        event.type === EventType.TEXT_MESSAGE_CONTENT && projectionOwner !== undefined &&
        isMessageProjectionTerminal(projectionOwner.lifecycle)
      ) fail("agui_message_owner_terminal_conflict");
      if (event.type === EventType.TEXT_MESSAGE_END) {
        messageUpdate = { ref: messageRef, authority: { ...message, state: "ended" } };
      }
    } else if (event.type === EventType.ACTIVITY_SNAPSHOT) {
      const runOwner = runRef === undefined ? undefined : runProjectionOwners.get(runRef);
      const messageOwner = messageRef === undefined ? undefined : messageProjectionOwners.get(messageRef);
      if (
        runRef === undefined || messageRef === undefined || runs.get(runRef)?.state !== "open" ||
        messages.get(messageRef)?.state !== "open" ||
        (runOwner !== undefined && isRunProjectionTerminal(runOwner.state)) ||
        (messageOwner !== undefined && isMessageProjectionTerminal(messageOwner.lifecycle))
      ) {
        fail("agui_frame_message_binding_invalid");
      }
    } else if (event.type === EventType.CUSTOM) {
      if (event.name === "kokoro.session.replace.v1" && event.value.sessionId !== parsedGrant.data.sessionId) {
        fail("agui_custom_session_scope_conflict");
      }
      if (event.name === "kokoro.run.replace.v1") {
        if (runRef === undefined) fail("agui_frame_run_binding_invalid");
        const current = runProjectionOwners.get(runRef);
        if (current !== undefined && (current.runBindingRef !== runRef || current.runId !== event.value.presentationRunId)) {
          fail("agui_run_owner_identity_conflict");
        }
        const run = runs.get(runRef);
        if (run === undefined || run.runId !== event.value.presentationRunId) fail("agui_frame_run_binding_invalid");
        if (run.state !== "open" && run.state !== event.value.state) fail("agui_run_owner_terminal_conflict");
        if (
          isRunProjectionTerminal(event.value.state) &&
          [...messages.values()].some((message) => message.runBindingRef === runRef && message.state === "open")
        ) fail("agui_run_message_open");
        const fingerprint = stableStringify(event.value);
        const versionAdmission = assertOwnerVersion(
          "run",
          current?.version,
          event.value.ownerVersion,
          current?.fingerprint,
          fingerprint,
        );
        if (versionAdmission === "advance") {
          if (current === undefined && runProjectionOwners.size >= runLimit) fail("agui_authority_capacity_exceeded");
          if (current !== undefined && !runProjectionTransitions[current.state].has(event.value.state)) {
            fail("agui_run_owner_transition_invalid");
          }
          runProjectionUpdate = {
            ref: runRef,
            authority: {
              runBindingRef: runRef,
              runId: event.value.presentationRunId,
              version: event.value.ownerVersion,
              state: event.value.state,
              fingerprint,
            },
          };
        }
      } else if (event.name === "kokoro.message.replace.v1") {
        if (runRef === undefined || messageRef === undefined || runs.get(runRef)?.state !== "open") {
          fail("agui_frame_message_binding_invalid");
        }
        const message = messages.get(messageRef);
        if (message === undefined || message.messageId !== event.value.presentationMessageId) {
          fail("agui_frame_message_binding_invalid");
        }
        if (message.state === "ended" && !isMessageProjectionTerminal(event.value.lifecycle)) {
          fail("agui_message_owner_terminal_conflict");
        }
        const current = messageProjectionOwners.get(messageRef);
        if (
          current !== undefined &&
          (
            current.runBindingRef !== runRef || current.messageBindingRef !== messageRef ||
            current.messageId !== event.value.presentationMessageId || current.role !== event.value.role ||
            current.parentPresentationMessageId !== event.value.parentPresentationMessageId ||
            current.ordinal !== event.value.ordinal
          )
        ) fail("agui_message_owner_identity_conflict");
        const fingerprint = stableStringify(event.value);
        const versionAdmission = assertOwnerVersion(
          "message",
          current?.version,
          event.value.version,
          current?.fingerprint,
          fingerprint,
        );
        if (versionAdmission === "advance") {
          if (current === undefined && messageProjectionOwners.size >= messageLimit) fail("agui_authority_capacity_exceeded");
          if (current !== undefined && !messageProjectionTransitions[current.lifecycle].has(event.value.lifecycle)) {
            fail("agui_message_owner_transition_invalid");
          }
          messageProjectionUpdate = {
            ref: messageRef,
            authority: {
              runBindingRef: runRef,
              messageBindingRef: messageRef,
              messageId: event.value.presentationMessageId,
              role: event.value.role,
              parentPresentationMessageId: event.value.parentPresentationMessageId,
              ordinal: event.value.ordinal,
              version: event.value.version,
              lifecycle: event.value.lifecycle,
              fingerprint,
            },
          };
        }
      } else if (runRef !== undefined && runs.get(runRef)?.state !== "open") {
        fail("agui_terminal_run_revived");
      }
    }

    assertTrustedSnapshotBindingEvidence(data, trustedBinding);

    const nextCursorBinding: AguiCursorBinding = Object.freeze({
      cursor: durableCursor,
      sessionId: data.source.sessionId,
      streamEpoch: data.source.streamEpoch,
      durableSeq: data.source.durableSeq,
      profileRevision: data.profileRevision,
      cursorProfileRevision: parsedGrant.data.cursorProfileRevision,
    });
    const decoded: AguiDurableFrame = deepFreeze({
      kind: "durable",
      id: durableCursor as SessionCursor,
      event: data.event.type,
      data,
      cursorBinding: nextCursorBinding,
    });

    const nextRuns = new Map(runs);
    const nextRunIds = new Map(runIds);
    const nextMessages = new Map(messages);
    const nextMessageIds = new Map(messageIds);
    const nextRunProjectionOwners = new Map(runProjectionOwners);
    const nextMessageProjectionOwners = new Map(messageProjectionOwners);
    let nextPresentationThreadId = presentationThreadId;
    if (runUpdate !== undefined) {
      nextRuns.set(runUpdate.ref, runUpdate.authority);
      nextRunIds.set(runUpdate.authority.runId, runUpdate.ref);
      nextPresentationThreadId ??= runUpdate.authority.threadId;
    }
    if (messageUpdate !== undefined) {
      nextMessages.set(messageUpdate.ref, messageUpdate.authority);
      nextMessageIds.set(messageUpdate.authority.messageId, messageUpdate.ref);
    }
    if (runProjectionUpdate !== undefined) {
      nextRunProjectionOwners.set(runProjectionUpdate.ref, runProjectionUpdate.authority);
    }
    if (messageProjectionUpdate !== undefined) {
      nextMessageProjectionOwners.set(messageProjectionUpdate.ref, messageProjectionUpdate.authority);
    }
    const nextSeenCursors = new Set(seenCursors);
    nextSeenCursors.add(durableCursor);
    const nextSourceEventIds = new Set(sourceEventIds);
    nextSourceEventIds.add(data.source.sourceEventId);
    const nextState: AguiDecoderState = Object.freeze({
      cursorBinding: nextCursorBinding,
      lastRecordedAt: recordedAt,
      lastDecoded: decoded,
      lastCommittedFrame: frame,
      ...(nextPresentationThreadId === undefined ? {} : { presentationThreadId: nextPresentationThreadId }),
      seenCursors: nextSeenCursors,
      sourceEventIds: nextSourceEventIds,
      runs: nextRuns,
      runIds: nextRunIds,
      messages: nextMessages,
      messageIds: nextMessageIds,
      trustedRuns: nextTrustedRuns,
      trustedMessages: nextTrustedMessages,
      runProjectionOwners: nextRunProjectionOwners,
      messageProjectionOwners: nextMessageProjectionOwners,
    });

    let committed = false;
    const prepared: AguiPreparedFrame = Object.freeze({
      decoded,
      commit(acknowledgement) {
        assertCommitAcknowledgement(acknowledgement);
        if (committed) return;
        if (pending?.prepared !== prepared) fail("agui_admission_commit_conflict");
        state = nextState;
        committed = true;
        pending = undefined;
      },
    });
    pending = Object.freeze({ frame, prepared });
    return prepared;
  };

  const decoder: AguiPresentationDecoder = Object.freeze({
    prepare,
    getResumeRequest() {
      return Object.freeze({
        headers: Object.freeze({ [LAST_EVENT_ID_HEADER]: state.cursorBinding.cursor }),
        queryCursor: state.cursorBinding.cursor,
        cursorBinding: state.cursorBinding,
      });
    },
  });
  aguiPresentationSnapshotReadersForTesting.set(decoder, () => deepFreeze({
    authority: snapshot.authority,
    hydrate: snapshot.hydrate,
    repair: snapshot.repair,
    profileRevision: state.cursorBinding.profileRevision,
    sessionId: state.cursorBinding.sessionId,
    streamEpoch: state.cursorBinding.streamEpoch,
    durableSeq: state.cursorBinding.durableSeq,
    lastRecordedAt: state.lastRecordedAt < 0
      ? null
      : canonicalUtcMsSchema.parse(new Date(state.lastRecordedAt).toISOString()),
    cursor: state.cursorBinding.cursor,
    runBindings: [...state.trustedRuns.values()],
    messageBindings: [...state.trustedMessages.values()],
  }));
  return decoder;
}

export function createAguiPresentationDecoder(options: Readonly<{
  grant: AguiGrantBinding;
  snapshotAuthority: unknown;
  limits?: Readonly<{
    streamIdentities?: number;
    runs?: number;
    messages?: number;
  }>;
}>): AguiPresentationDecoder {
  return createAguiPresentationDecoderInternal(options);
}
