// Web-owned frozen compatibility validator for the active Session browser-v3
// `kokoro-agui-presentation.v1` lane. This is reviewed runtime source, not a
// Root-generated mirror. Retire it only through one coordinated Session/Web
// migration to the canonical Presentation binding and frame shapes.

import { z } from "zod";

export const aguiBindingAuthorityContractMetadata = Object.freeze({
  owner: "kokoro-web",
  activeLane: "session-browser-v3",
  contractRevision: "kokoro.web.session-browser-v3-binding-compat.v1",
  profileRevision: "kokoro-agui-presentation.v1",
});

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const runBindingRefPattern = /^presentation\.run-binding:[0-9a-f]{64}$/u;
const messageBindingRefPattern = /^presentation\.message-binding:[0-9a-f]{64}$/u;
const ownerBindingRefPattern = /^presentation\.owner-binding:[0-9a-f]{64}$/u;
const presentationThreadIdPattern = /^presentation\.thread:[0-9a-f]{64}$/u;
const presentationRunIdPattern = /^presentation\.run:[0-9a-f]{64}$/u;
const presentationMessageIdPattern = /^presentation\.message:[0-9a-f]{64}$/u;
const publicSourceEventIdPattern = /^presentation\.event:(?![A-Za-z0-9._:-]*agent\.event)[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const dateTimePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/u;
const canonicalUtcMsPattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;

const idSchema = z.string().min(1).max(128).regex(idPattern);
export const aguiPresentationRunBindingRefSchema = z.string()
  .regex(runBindingRefPattern)
  .brand<"AguiPresentationRunBindingRef">();
export const aguiPresentationMessageBindingRefSchema = z.string()
  .regex(messageBindingRefPattern)
  .brand<"AguiPresentationMessageBindingRef">();
export const aguiPresentationOwnerBindingRefSchema = z.string()
  .regex(ownerBindingRefPattern)
  .brand<"AguiPresentationOwnerBindingRef">();
export const aguiPresentationThreadIdSchema = z.string()
  .regex(presentationThreadIdPattern)
  .brand<"AguiPresentationThreadId">();
export const aguiPresentationRunIdSchema = z.string()
  .regex(presentationRunIdPattern)
  .brand<"AguiPresentationRunId">();
export const aguiPresentationMessageIdSchema = z.string()
  .regex(presentationMessageIdPattern)
  .brand<"AguiPresentationMessageId">();
export const aguiPublicSourceEventIdSchema = z.string()
  .min(20)
  .max(128)
  .regex(publicSourceEventIdPattern)
  .brand<"AguiPublicSourceEventId">();
const dateTimeSchema = z.string().min(20).max(35).regex(dateTimePattern);

export type AguiPresentationRunBindingRef = z.infer<typeof aguiPresentationRunBindingRefSchema>;
export type AguiPresentationMessageBindingRef = z.infer<typeof aguiPresentationMessageBindingRefSchema>;
export type AguiPresentationOwnerBindingRef = z.infer<typeof aguiPresentationOwnerBindingRefSchema>;
export type AguiPresentationThreadId = z.infer<typeof aguiPresentationThreadIdSchema>;
export type AguiPresentationRunId = z.infer<typeof aguiPresentationRunIdSchema>;
export type AguiPresentationMessageId = z.infer<typeof aguiPresentationMessageIdSchema>;
export type AguiPublicSourceEventId = z.infer<typeof aguiPublicSourceEventIdSchema>;

const parentLineageSchema = z.strictObject({
  parentPresentationRunId: aguiPresentationRunIdSchema.nullable(),
});

export const aguiPresentationRunBindingSchema = z.strictObject({
  bindingRef: aguiPresentationRunBindingRefSchema,
  profileRevision: z.literal("kokoro-agui-presentation.v1"),
  sessionId: idSchema,
  presentationThreadId: aguiPresentationThreadIdSchema,
  presentationRunId: aguiPresentationRunIdSchema,
  sessionRunId: idSchema.nullable(),
  segmentOrdinal: z.number().int().min(0).max(65_535),
  resumeOfPresentationRunId: aguiPresentationRunIdSchema.nullable(),
  parentLineage: parentLineageSchema,
  state: z.enum(["open", "finished", "error"]),
  terminalDisposition: z.enum(["success", "interrupted", "error", "canceled"]).nullable(),
  openedBySourceEventId: aguiPublicSourceEventIdSchema,
  terminalSourceEventId: aguiPublicSourceEventIdSchema.nullable(),
  openedAt: dateTimeSchema,
  terminalAt: dateTimeSchema.nullable(),
}).superRefine((binding, context) => {
  if ((binding.segmentOrdinal === 0) !== (binding.resumeOfPresentationRunId === null)) {
    context.addIssue({ code: "custom", message: "resume segment" });
  }
  const isOpen = binding.state === "open";
  if (
    isOpen !== (binding.terminalDisposition === null) ||
    isOpen !== (binding.terminalSourceEventId === null) ||
    isOpen !== (binding.terminalAt === null)
  ) {
    context.addIssue({ code: "custom", message: "terminal evidence" });
  }
});

export type AguiPresentationRunBinding = Readonly<z.infer<typeof aguiPresentationRunBindingSchema>>;

export const aguiPresentationMessageBindingSchema = z.strictObject({
  bindingRef: aguiPresentationMessageBindingRefSchema,
  profileRevision: z.literal("kokoro-agui-presentation.v1"),
  sessionId: idSchema,
  presentationRunBindingRef: aguiPresentationRunBindingRefSchema,
  presentationMessageId: aguiPresentationMessageIdSchema,
  sessionMessageId: idSchema.nullable(),
  sessionTextPartId: idSchema.nullable(),
  resumeSegmentOrdinal: z.number().int().min(0).max(65_535),
  state: z.enum(["open", "ended"]),
  openedBySourceEventId: aguiPublicSourceEventIdSchema,
  endedBySourceEventId: aguiPublicSourceEventIdSchema.nullable(),
  openedAt: dateTimeSchema,
  endedAt: dateTimeSchema.nullable(),
}).superRefine((binding, context) => {
  if ((binding.sessionMessageId === null) !== (binding.sessionTextPartId === null)) {
    context.addIssue({ code: "custom", message: "Session message/text binding pair" });
  }
  const isOpen = binding.state === "open";
  if (isOpen !== (binding.endedBySourceEventId === null) || isOpen !== (binding.endedAt === null)) {
    context.addIssue({ code: "custom", message: "end evidence" });
  }
});

export type AguiPresentationMessageBinding = Readonly<z.infer<typeof aguiPresentationMessageBindingSchema>>;

const ownerIdentitySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("safe-summary"), partRef: idSchema }),
  z.strictObject({ kind: z.literal("tool"), toolCallRef: idSchema }),
  z.strictObject({ kind: z.literal("hitl"), ownerRef: idSchema, decisionGroupRef: idSchema, controlRef: idSchema }),
  z.strictObject({ kind: z.literal("plan"), planRef: idSchema }),
  z.strictObject({ kind: z.literal("subagent"), subagentRef: idSchema }),
  z.strictObject({
    kind: z.literal("media"), mediaOperationRef: idSchema, definitionRef: idSchema,
    definitionRevisionRef: idSchema, modelOptionRevisionRef: idSchema.nullable(),
  }),
  z.strictObject({ kind: z.literal("artifact"), artifactRef: idSchema, artifactVersionRef: idSchema }),
  z.strictObject({ kind: z.literal("cost"), mediaOperationRef: idSchema, costProjectionRef: idSchema }),
  z.strictObject({ kind: z.literal("notice"), noticeRef: idSchema }),
  z.strictObject({ kind: z.literal("error"), errorRef: idSchema }),
  z.strictObject({ kind: z.literal("control"), controlRef: idSchema, ownerRef: idSchema, decisionGroupRef: idSchema }),
  z.strictObject({
    kind: z.literal("receipt"), receiptRef: idSchema, controlRef: idSchema,
    ownerRef: idSchema, decisionGroupRef: idSchema,
  }),
]);

const canonicalUtcMsSchema = z.string().regex(canonicalUtcMsPattern).refine((value) => {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
});

export const aguiPresentationOwnerBindingSchema = z.strictObject({
  profileRevision: z.literal("kokoro-agui-presentation.v1"),
  schemaRevision: z.literal(1),
  bindingRef: aguiPresentationOwnerBindingRefSchema,
  sessionId: idSchema,
  presentationRunBindingRef: aguiPresentationRunBindingRefSchema,
  presentationMessageBindingRef: aguiPresentationMessageBindingRefSchema.nullable(),
  presentationOwnerMessageId: aguiPresentationMessageIdSchema.nullable(),
  ownerIdentity: ownerIdentitySchema,
  targetOwnerBindingRef: aguiPresentationOwnerBindingRefSchema.nullable(),
  controlOwnerBindingRef: aguiPresentationOwnerBindingRefSchema.nullable(),
  boundBySourceEventId: aguiPublicSourceEventIdSchema,
  boundAt: canonicalUtcMsSchema,
}).superRefine((binding, context) => {
  const control = binding.ownerIdentity.kind === "control";
  const receipt = binding.ownerIdentity.kind === "receipt";
  const runScoped = control || receipt;
  if ((runScoped && binding.presentationMessageBindingRef !== null) ||
      runScoped !== (binding.presentationOwnerMessageId === null) ||
      receipt !== (binding.controlOwnerBindingRef !== null) ||
      runScoped !== (binding.targetOwnerBindingRef !== null)) {
    context.addIssue({ code: "custom", message: "owner placement and ancestry" });
  }
});

export type AguiPresentationOwnerBinding = Readonly<z.infer<typeof aguiPresentationOwnerBindingSchema>>;

export const aguiPresentationBindingAuthorityDeltaSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("run.replace"), binding: aguiPresentationRunBindingSchema }),
  z.strictObject({ kind: z.literal("message.replace"), binding: aguiPresentationMessageBindingSchema }),
  z.strictObject({ kind: z.literal("owner.replace"), binding: aguiPresentationOwnerBindingSchema }),
]);

export type AguiPresentationBindingAuthorityDelta = Readonly<
  z.infer<typeof aguiPresentationBindingAuthorityDeltaSchema>
>;
