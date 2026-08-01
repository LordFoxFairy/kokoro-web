// GENERATED — DO NOT EDIT.
// Sources:
//   contract/spec/presentation-run-binding-v1.yaml
//   contract/spec/presentation-message-binding-v1.yaml
// Generation authority: Kokoro Root contract authority.

import { z } from "zod";

export const aguiBindingAuthorityContractMetadata = Object.freeze({
  profileRevision: "kokoro-agui-presentation.v1",
  sources: Object.freeze({
    "contract/spec/presentation-run-binding-v1.yaml":
      "dd5318258dbf8a33065e533b62b84ed08440c25af358235663a8d40b26ef5063",
    "contract/spec/presentation-message-binding-v1.yaml":
      "d4817d5ae5010393d60f1597576bbc08355c0edfb268ea72014ffea49964e9a7",
  }),
});

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const dateTimePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{3})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/u;

const idSchema = z.string().min(1).max(128).regex(idPattern);
const dateTimeSchema = z.string().min(20).max(35).regex(dateTimePattern);

const parentLineageSchema = z.strictObject({
  parentInternalRunRef: idSchema.nullable(),
  parentPresentationRunId: idSchema.nullable(),
}).superRefine((lineage, context) => {
  if ((lineage.parentInternalRunRef === null) !== (lineage.parentPresentationRunId === null)) {
    context.addIssue({ code: "custom", message: "parent lineage pair" });
  }
});

export const aguiPresentationRunBindingSchema = z.strictObject({
  bindingRef: idSchema,
  profileRevision: z.literal("kokoro-agui-presentation.v1"),
  sessionId: idSchema,
  internalRunRef: idSchema,
  presentationThreadId: idSchema,
  presentationRunId: idSchema,
  segmentOrdinal: z.number().int().min(0).max(65_535),
  resumeOfPresentationRunId: idSchema.nullable(),
  parentLineage: parentLineageSchema,
  state: z.enum(["open", "finished", "error"]),
  terminalDisposition: z.enum(["success", "interrupted", "error", "canceled"]).nullable(),
  openedBySourceEventId: idSchema,
  terminalSourceEventId: idSchema.nullable(),
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
  bindingRef: idSchema,
  profileRevision: z.literal("kokoro-agui-presentation.v1"),
  sessionId: idSchema,
  internalMessageRef: idSchema,
  presentationRunBindingRef: idSchema,
  presentationMessageId: idSchema,
  resumeSegmentOrdinal: z.number().int().min(0).max(65_535),
  state: z.enum(["open", "ended"]),
  openedBySourceEventId: idSchema,
  endedBySourceEventId: idSchema.nullable(),
  openedAt: dateTimeSchema,
  endedAt: dateTimeSchema.nullable(),
}).superRefine((binding, context) => {
  const isOpen = binding.state === "open";
  if (isOpen !== (binding.endedBySourceEventId === null) || isOpen !== (binding.endedAt === null)) {
    context.addIssue({ code: "custom", message: "end evidence" });
  }
});

export type AguiPresentationMessageBinding = Readonly<z.infer<typeof aguiPresentationMessageBindingSchema>>;
