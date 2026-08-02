// GENERATED — DO NOT EDIT.
// Sources:
//   contract/spec/presentation-run-binding-v1.yaml
//   contract/spec/presentation-message-binding-v1.yaml
//   contract/spec/presentation-binding-authority-delta-v1.yaml
// Generation authority: Kokoro Root contract authority.

import { z } from "zod";

export const aguiBindingAuthorityContractMetadata = Object.freeze({
  profileRevision: "kokoro-agui-presentation.v1",
  sources: Object.freeze({
    "contract/spec/presentation-run-binding-v1.yaml":
      "54d50fd4179147e5b421d5ce6c957dce8d36be68906ba19bebd6372eea4136fe",
    "contract/spec/presentation-message-binding-v1.yaml":
      "56a2b5728f6ac880eb44648f30b0a05a09cf58ae713bc4f111a02928211dd1a5",
    "contract/spec/presentation-binding-authority-delta-v1.yaml":
      "9fd30b734e2aa5f52be50eb1442eaf16843de8baa8098fcc996bc5e057f9dd2d",
  }),
});

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const runBindingRefPattern = /^presentation\.run-binding:[0-9a-f]{64}$/u;
const messageBindingRefPattern = /^presentation\.message-binding:[0-9a-f]{64}$/u;
const presentationThreadIdPattern = /^presentation\.thread:[0-9a-f]{64}$/u;
const presentationRunIdPattern = /^presentation\.run:[0-9a-f]{64}$/u;
const presentationMessageIdPattern = /^presentation\.message:[0-9a-f]{64}$/u;
const publicSourceEventIdPattern = /^presentation\.event:(?![A-Za-z0-9._:-]*agent\.event)[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const dateTimePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/u;

const idSchema = z.string().min(1).max(128).regex(idPattern);
export const aguiPresentationRunBindingRefSchema = z.string()
  .regex(runBindingRefPattern)
  .brand<"AguiPresentationRunBindingRef">();
export const aguiPresentationMessageBindingRefSchema = z.string()
  .regex(messageBindingRefPattern)
  .brand<"AguiPresentationMessageBindingRef">();
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

export const aguiPresentationBindingAuthorityDeltaSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("run.replace"), binding: aguiPresentationRunBindingSchema }),
  z.strictObject({ kind: z.literal("message.replace"), binding: aguiPresentationMessageBindingSchema }),
]);

export type AguiPresentationBindingAuthorityDelta = Readonly<
  z.infer<typeof aguiPresentationBindingAuthorityDeltaSchema>
>;
