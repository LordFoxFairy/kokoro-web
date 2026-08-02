#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const aguiBindingAuthoritySources = Object.freeze([
  "contract/spec/presentation-run-binding-v1.yaml",
  "contract/spec/presentation-message-binding-v1.yaml",
  "contract/spec/presentation-owner-binding-v1.yaml",
  "contract/spec/presentation-binding-authority-delta-v1.yaml",
]);

const [runSourcePath, messageSourcePath, ownerSourcePath, deltaSourcePath] = aguiBindingAuthoritySources;
const idRef = Object.freeze({ $ref: "#/$defs/id" });
const runBindingRef = Object.freeze({ $ref: "#/$defs/runBindingRef" });
const messageBindingRef = Object.freeze({ $ref: "#/$defs/messageBindingRef" });
const presentationThreadIdRef = Object.freeze({ $ref: "#/$defs/presentationThreadId" });
const presentationRunIdRef = Object.freeze({ $ref: "#/$defs/presentationRunId" });
const presentationMessageIdRef = Object.freeze({ $ref: "#/$defs/presentationMessageId" });
const publicSourceEventIdRef = Object.freeze({ $ref: "#/$defs/publicSourceEventId" });
const dateTimeRef = Object.freeze({ $ref: "#/$defs/dateTime" });
const nullType = Object.freeze({ type: "null" });

function fail(label) {
  throw new Error(`Unsupported AG-UI binding authority schema: ${label}`);
}

function expectRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(label);
  return value;
}

function expectEqual(actual, expected, label) {
  if (!isDeepStrictEqual(actual, expected)) fail(label);
}

function expectKeys(value, expected, label) {
  expectEqual(Object.keys(expectRecord(value, label)).sort(), [...expected].sort(), `${label} keys`);
}

function parseSource(source, relativePath) {
  if (typeof source !== "string") fail(`${relativePath} source`);
  try {
    return expectRecord(JSON.parse(source), relativePath);
  } catch (error) {
    if (error instanceof SyntaxError) fail(`${relativePath} JSON`);
    throw error;
  }
}

function inspectDefinitions(schema, label, opaqueNames) {
  expectKeys(schema.$defs, ["id", "publicSourceEventId", "dateTime", ...opaqueNames], `${label} definitions`);
  const id = expectRecord(schema.$defs.id, `${label} id definition`);
  const publicSourceEventId = expectRecord(
    schema.$defs.publicSourceEventId,
    `${label} public source event id definition`,
  );
  const dateTime = expectRecord(schema.$defs.dateTime, `${label} date-time definition`);
  expectKeys(id, ["type", "minLength", "maxLength", "pattern"], `${label} id definition`);
  expectKeys(
    publicSourceEventId,
    ["type", "minLength", "maxLength", "pattern"],
    `${label} public source event id definition`,
  );
  expectKeys(
    dateTime,
    ["type", "minLength", "maxLength", "pattern"],
    `${label} date-time definition`,
  );
  if (
    publicSourceEventId.type !== "string" ||
    !Number.isSafeInteger(publicSourceEventId.minLength) ||
    !Number.isSafeInteger(publicSourceEventId.maxLength) ||
    typeof publicSourceEventId.pattern !== "string"
  ) {
    fail(`${label} public source event id definition values`);
  }
  if (
    id.type !== "string" ||
    !Number.isSafeInteger(id.minLength) ||
    !Number.isSafeInteger(id.maxLength) ||
    typeof id.pattern !== "string"
  ) {
    fail(`${label} id definition values`);
  }
  if (
    dateTime.type !== "string" ||
    !Number.isSafeInteger(dateTime.minLength) ||
    !Number.isSafeInteger(dateTime.maxLength) ||
    typeof dateTime.pattern !== "string"
  ) {
    fail(`${label} date-time definition values`);
  }
  const opaque = Object.fromEntries(opaqueNames.map((name) => {
    const definition = expectRecord(schema.$defs[name], `${label} ${name} definition`);
    expectKeys(definition, ["type", "pattern"], `${label} ${name} definition`);
    if (definition.type !== "string" || typeof definition.pattern !== "string") {
      fail(`${label} ${name} definition values`);
    }
    return [name, definition];
  }));
  return { id, publicSourceEventId, dateTime, opaque };
}

function inspectObjectEnvelope(schema, expectedId, required, label) {
  expectKeys(
    schema,
    [
      "$schema",
      "$id",
      "title",
      "description",
      "type",
      "additionalProperties",
      "required",
      "properties",
      "allOf",
      "$defs",
    ],
    label,
  );
  expectEqual(schema.$schema, "https://json-schema.org/draft/2020-12/schema", `${label} draft`);
  expectEqual(schema.$id, expectedId, `${label} id`);
  expectEqual(schema.type, "object", `${label} type`);
  expectEqual(schema.additionalProperties, false, `${label} additional properties`);
  expectEqual(schema.required, required, `${label} required fields`);
  expectKeys(schema.properties, required, `${label} properties`);
}

function inspectRunSchema(schema) {
  const required = [
    "bindingRef",
    "profileRevision",
    "sessionId",
    "presentationThreadId",
    "presentationRunId",
    "sessionRunId",
    "segmentOrdinal",
    "resumeOfPresentationRunId",
    "parentLineage",
    "state",
    "terminalDisposition",
    "openedBySourceEventId",
    "terminalSourceEventId",
    "openedAt",
    "terminalAt",
  ];
  inspectObjectEnvelope(
    schema,
    "https://contracts.kokoro.invalid/presentation-run-binding.v1.schema.json",
    required,
    "run binding",
  );
  const properties = schema.properties;
  expectEqual(properties.bindingRef, runBindingRef, "run binding bindingRef");
  expectEqual(properties.sessionId, idRef, "run binding sessionId");
  expectEqual(properties.presentationThreadId, presentationThreadIdRef, "run binding presentationThreadId");
  expectEqual(properties.presentationRunId, presentationRunIdRef, "run binding presentationRunId");
  const sessionRunId = expectRecord(properties.sessionRunId, "run binding sessionRunId");
  expectKeys(sessionRunId, ["description", "oneOf"], "run binding sessionRunId");
  expectEqual(sessionRunId.oneOf, [idRef, nullType], "run binding sessionRunId union");
  if (typeof sessionRunId.description !== "string" || sessionRunId.description.length === 0) {
    fail("run binding sessionRunId description");
  }
  expectEqual(properties.resumeOfPresentationRunId, { oneOf: [presentationRunIdRef, nullType] }, "run binding resumeOfPresentationRunId");
  expectEqual(properties.openedBySourceEventId, publicSourceEventIdRef, "run binding opened source");
  expectEqual(properties.terminalSourceEventId, { oneOf: [publicSourceEventIdRef, nullType] }, "run binding terminal source");
  expectEqual(properties.openedAt, dateTimeRef, "run binding openedAt");
  expectEqual(properties.terminalAt, { oneOf: [dateTimeRef, nullType] }, "run binding terminalAt");

  const profileRevision = expectRecord(properties.profileRevision, "run profile revision").const;
  if (typeof profileRevision !== "string" || profileRevision.length === 0) fail("run profile revision");
  const segment = expectRecord(properties.segmentOrdinal, "run segment ordinal");
  expectKeys(segment, ["type", "minimum", "maximum"], "run segment ordinal");
  if (
    segment.type !== "integer" ||
    !Number.isSafeInteger(segment.minimum) ||
    !Number.isSafeInteger(segment.maximum)
  ) {
    fail("run segment ordinal values");
  }
  const states = expectRecord(properties.state, "run state").enum;
  const dispositions = expectRecord(properties.terminalDisposition, "run terminal disposition").oneOf?.[0]
    ?.enum;
  if (!Array.isArray(states) || states[0] !== "open" || !states.every((item) => typeof item === "string")) {
    fail("run states");
  }
  if (
    !Array.isArray(dispositions) ||
    dispositions.length === 0 ||
    !dispositions.every((item) => typeof item === "string")
  ) {
    fail("run terminal dispositions");
  }
  expectEqual(
    properties.terminalDisposition,
    { oneOf: [{ enum: dispositions }, nullType] },
    "run terminal disposition",
  );

  const parentLineage = expectRecord(properties.parentLineage, "run parent lineage");
  expectEqual(parentLineage, {
    type: "object",
    additionalProperties: false,
    required: ["parentPresentationRunId"],
    properties: {
      parentPresentationRunId: { oneOf: [presentationRunIdRef, nullType] },
    },
  }, "run parent lineage semantics");
  expectEqual(schema.allOf, [
    {
      if: { properties: { segmentOrdinal: { const: segment.minimum } }, required: ["segmentOrdinal"] },
      then: { properties: { resumeOfPresentationRunId: nullType } },
      else: { properties: { resumeOfPresentationRunId: presentationRunIdRef } },
    },
    {
      if: { properties: { state: { const: "open" } }, required: ["state"] },
      then: {
        properties: {
          terminalDisposition: nullType,
          terminalSourceEventId: nullType,
          terminalAt: nullType,
        },
      },
      else: {
        properties: {
          terminalDisposition: { enum: dispositions },
          terminalSourceEventId: publicSourceEventIdRef,
          terminalAt: dateTimeRef,
        },
      },
    },
  ], "run conditional semantics");

  return { profileRevision, segment, states, dispositions };
}

function inspectMessageSchema(schema) {
  const required = [
    "bindingRef",
    "profileRevision",
    "sessionId",
    "presentationRunBindingRef",
    "presentationMessageId",
    "sessionMessageId",
    "sessionTextPartId",
    "resumeSegmentOrdinal",
    "state",
    "openedBySourceEventId",
    "endedBySourceEventId",
    "openedAt",
    "endedAt",
  ];
  inspectObjectEnvelope(
    schema,
    "https://contracts.kokoro.invalid/presentation-message-binding.v1.schema.json",
    required,
    "message binding",
  );
  const properties = schema.properties;
  expectEqual(properties.bindingRef, messageBindingRef, "message binding bindingRef");
  expectEqual(properties.sessionId, idRef, "message binding sessionId");
  expectEqual(properties.presentationRunBindingRef, runBindingRef, "message binding presentationRunBindingRef");
  expectEqual(properties.presentationMessageId, presentationMessageIdRef, "message binding presentationMessageId");
  for (const field of ["sessionMessageId", "sessionTextPartId"]) {
    const property = expectRecord(properties[field], `message binding ${field}`);
    expectKeys(property, ["description", "oneOf"], `message binding ${field}`);
    expectEqual(property.oneOf, [idRef, nullType], `message binding ${field} union`);
    if (typeof property.description !== "string" || property.description.length === 0) {
      fail(`message binding ${field} description`);
    }
  }
  expectEqual(properties.openedBySourceEventId, publicSourceEventIdRef, "message opened source");
  expectEqual(properties.endedBySourceEventId, { oneOf: [publicSourceEventIdRef, nullType] }, "message ended source");
  expectEqual(properties.openedAt, dateTimeRef, "message openedAt");
  expectEqual(properties.endedAt, { oneOf: [dateTimeRef, nullType] }, "message endedAt");

  const profileRevision = expectRecord(properties.profileRevision, "message profile revision").const;
  if (typeof profileRevision !== "string" || profileRevision.length === 0) {
    fail("message profile revision");
  }
  const segment = expectRecord(properties.resumeSegmentOrdinal, "message segment ordinal");
  expectKeys(segment, ["type", "minimum", "maximum"], "message segment ordinal");
  if (
    segment.type !== "integer" ||
    !Number.isSafeInteger(segment.minimum) ||
    !Number.isSafeInteger(segment.maximum)
  ) {
    fail("message segment ordinal values");
  }
  const states = expectRecord(properties.state, "message state").enum;
  if (!Array.isArray(states) || states[0] !== "open" || !states.every((item) => typeof item === "string")) {
    fail("message states");
  }
  expectEqual(schema.allOf, [
    {
      if: { properties: { sessionMessageId: nullType }, required: ["sessionMessageId"] },
      then: { properties: { sessionTextPartId: nullType } },
      else: { properties: { sessionTextPartId: idRef } },
    },
    {
      if: { properties: { state: { const: "open" } }, required: ["state"] },
      then: { properties: { endedBySourceEventId: nullType, endedAt: nullType } },
      else: { properties: { endedBySourceEventId: publicSourceEventIdRef, endedAt: dateTimeRef } },
    },
  ], "message conditional semantics");

  return { profileRevision, segment, states };
}

function inspectDeltaSchema(schema) {
  expectKeys(schema, ["$schema", "$id", "title", "description", "oneOf", "$defs"], "binding delta");
  expectEqual(schema.$schema, "https://json-schema.org/draft/2020-12/schema", "binding delta draft");
  expectEqual(
    schema.$id,
    "https://contracts.kokoro.invalid/presentation-binding-authority-delta.v1.schema.json",
    "binding delta id",
  );
  expectEqual(schema.oneOf, [
    { $ref: "#/$defs/none" },
    { $ref: "#/$defs/runReplace" },
    { $ref: "#/$defs/messageReplace" },
    { $ref: "#/$defs/ownerReplace" },
  ], "binding delta union");
  expectEqual(schema.$defs, {
    none: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: { kind: { const: "none" } },
    },
    runReplace: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "binding"],
      properties: {
        kind: { const: "run.replace" },
        binding: { $ref: "https://contracts.kokoro.invalid/presentation-run-binding.v1.schema.json" },
      },
    },
    messageReplace: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "binding"],
      properties: {
        kind: { const: "message.replace" },
        binding: { $ref: "https://contracts.kokoro.invalid/presentation-message-binding.v1.schema.json" },
      },
    },
    ownerReplace: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "binding"],
      properties: {
        kind: { const: "owner.replace" },
        binding: { $ref: "https://contracts.kokoro.invalid/presentation-owner-binding.v1.schema.json" },
      },
    },
  }, "binding delta definitions");
}

function inspectOwnerSchema(schema) {
  const required = [
    "profileRevision", "schemaRevision", "bindingRef", "sessionId",
    "presentationRunBindingRef", "presentationMessageBindingRef", "presentationOwnerMessageId",
    "ownerIdentity", "targetOwnerBindingRef", "controlOwnerBindingRef",
    "boundBySourceEventId", "boundAt",
  ];
  inspectObjectEnvelope(
    schema,
    "https://contracts.kokoro.invalid/presentation-owner-binding.v1.schema.json",
    required,
    "owner binding",
  );
  expectEqual(schema.properties.profileRevision, { const: "kokoro-agui-presentation.v1" }, "owner profile");
  expectEqual(schema.properties.schemaRevision, { const: 1 }, "owner revision");
  expectEqual(schema.properties.presentationRunBindingRef, runBindingRef, "owner run binding");
  expectEqual(schema.properties.presentationMessageBindingRef, { oneOf: [nullType, messageBindingRef] }, "owner message binding");
  expectEqual(schema.properties.presentationOwnerMessageId, { oneOf: [nullType, presentationMessageIdRef] }, "owner message id");
  expectEqual(schema.properties.boundBySourceEventId, publicSourceEventIdRef, "owner source");
  expectEqual(schema.properties.boundAt, { $ref: "#/$defs/canonicalUtcMs" }, "owner time");
  const definitions = expectRecord(schema.$defs, "owner definitions");
  const ownerBinding = expectRecord(definitions.ownerBindingRef, "owner binding ref");
  const canonicalTime = expectRecord(definitions.canonicalUtcMs, "owner canonical time");
  const identity = expectRecord(definitions.ownerIdentity, "owner identity");
  if (typeof ownerBinding.pattern !== "string" || typeof canonicalTime.pattern !== "string") fail("owner patterns");
  expectEqual(identity.oneOf, [
    { $ref: "#/$defs/safeSummaryIdentity" }, { $ref: "#/$defs/toolIdentity" },
    { $ref: "#/$defs/hitlIdentity" }, { $ref: "#/$defs/planIdentity" },
    { $ref: "#/$defs/subagentIdentity" }, { $ref: "#/$defs/mediaIdentity" },
    { $ref: "#/$defs/artifactIdentity" }, { $ref: "#/$defs/costIdentity" },
    { $ref: "#/$defs/noticeIdentity" }, { $ref: "#/$defs/errorIdentity" },
    { $ref: "#/$defs/controlIdentity" }, { $ref: "#/$defs/receiptIdentity" },
  ], "owner identity union");
  return { ownerBindingPattern: ownerBinding.pattern, canonicalTimePattern: canonicalTime.pattern };
}

function digest(source) {
  return createHash("sha256").update(source).digest("hex");
}

function quote(value) {
  return JSON.stringify(value);
}

function renderEnum(values) {
  return `[${values.map(quote).join(", ")}]`;
}

function renderInteger(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, "_");
}

function renderRegex(pattern) {
  return `/${pattern.replaceAll("/", "\\/")}/u`;
}

export function generateAguiBindingAuthority(sources) {
  expectKeys(sources, aguiBindingAuthoritySources, "source set");
  const runSource = sources[runSourcePath];
  const messageSource = sources[messageSourcePath];
  const ownerSource = sources[ownerSourcePath];
  const deltaSource = sources[deltaSourcePath];
  const runSchema = parseSource(runSource, runSourcePath);
  const messageSchema = parseSource(messageSource, messageSourcePath);
  const ownerSchema = parseSource(ownerSource, ownerSourcePath);
  const deltaSchema = parseSource(deltaSource, deltaSourcePath);
  const run = inspectRunSchema(runSchema);
  const message = inspectMessageSchema(messageSchema);
  const owner = inspectOwnerSchema(ownerSchema);
  inspectDeltaSchema(deltaSchema);
  const runDefinitions = inspectDefinitions(
    runSchema,
    "run binding",
    ["runBindingRef", "presentationThreadId", "presentationRunId"],
  );
  const messageDefinitions = inspectDefinitions(
    messageSchema,
    "message binding",
    ["runBindingRef", "messageBindingRef", "presentationMessageId"],
  );
  expectEqual(
    { id: messageDefinitions.id, publicSourceEventId: messageDefinitions.publicSourceEventId, dateTime: messageDefinitions.dateTime },
    { id: runDefinitions.id, publicSourceEventId: runDefinitions.publicSourceEventId, dateTime: runDefinitions.dateTime },
    "shared definitions",
  );
  expectEqual(
    messageDefinitions.opaque.runBindingRef,
    runDefinitions.opaque.runBindingRef,
    "shared run binding ref",
  );
  expectEqual(message.profileRevision, run.profileRevision, "shared profile revision");
  expectEqual(message.segment, run.segment, "shared segment ordinal");

  const { id, publicSourceEventId, dateTime } = runDefinitions;
  const { runBindingRef: runBinding, presentationThreadId, presentationRunId } = runDefinitions.opaque;
  const { messageBindingRef: messageBinding, presentationMessageId } = messageDefinitions.opaque;
  return `// GENERATED — DO NOT EDIT.
// Sources:
//   ${runSourcePath}
//   ${messageSourcePath}
//   ${ownerSourcePath}
//   ${deltaSourcePath}
// Generation authority: Kokoro Root contract authority.

import { z } from "zod";

export const aguiBindingAuthorityContractMetadata = Object.freeze({
  profileRevision: ${quote(run.profileRevision)},
  sources: Object.freeze({
    ${quote(runSourcePath)}:
      ${quote(digest(runSource))},
    ${quote(messageSourcePath)}:
      ${quote(digest(messageSource))},
    ${quote(ownerSourcePath)}:
      ${quote(digest(ownerSource))},
    ${quote(deltaSourcePath)}:
      ${quote(digest(deltaSource))},
  }),
});

const idPattern = ${renderRegex(id.pattern)};
const runBindingRefPattern = ${renderRegex(runBinding.pattern)};
const messageBindingRefPattern = ${renderRegex(messageBinding.pattern)};
const ownerBindingRefPattern = ${renderRegex(owner.ownerBindingPattern)};
const presentationThreadIdPattern = ${renderRegex(presentationThreadId.pattern)};
const presentationRunIdPattern = ${renderRegex(presentationRunId.pattern)};
const presentationMessageIdPattern = ${renderRegex(presentationMessageId.pattern)};
const publicSourceEventIdPattern = ${renderRegex(publicSourceEventId.pattern)};
const dateTimePattern = ${renderRegex(dateTime.pattern)};
const canonicalUtcMsPattern = ${renderRegex(owner.canonicalTimePattern)};

const idSchema = z.string().min(${id.minLength}).max(${id.maxLength}).regex(idPattern);
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
  .min(${publicSourceEventId.minLength})
  .max(${publicSourceEventId.maxLength})
  .regex(publicSourceEventIdPattern)
  .brand<"AguiPublicSourceEventId">();
const dateTimeSchema = z.string().min(${dateTime.minLength}).max(${dateTime.maxLength}).regex(dateTimePattern);

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
  profileRevision: z.literal(${quote(run.profileRevision)}),
  sessionId: idSchema,
  presentationThreadId: aguiPresentationThreadIdSchema,
  presentationRunId: aguiPresentationRunIdSchema,
  sessionRunId: idSchema.nullable(),
  segmentOrdinal: z.number().int().min(${renderInteger(run.segment.minimum)}).max(${renderInteger(run.segment.maximum)}),
  resumeOfPresentationRunId: aguiPresentationRunIdSchema.nullable(),
  parentLineage: parentLineageSchema,
  state: z.enum(${renderEnum(run.states)}),
  terminalDisposition: z.enum(${renderEnum(run.dispositions)}).nullable(),
  openedBySourceEventId: aguiPublicSourceEventIdSchema,
  terminalSourceEventId: aguiPublicSourceEventIdSchema.nullable(),
  openedAt: dateTimeSchema,
  terminalAt: dateTimeSchema.nullable(),
}).superRefine((binding, context) => {
  if ((binding.segmentOrdinal === ${renderInteger(run.segment.minimum)}) !== (binding.resumeOfPresentationRunId === null)) {
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
  profileRevision: z.literal(${quote(message.profileRevision)}),
  sessionId: idSchema,
  presentationRunBindingRef: aguiPresentationRunBindingRefSchema,
  presentationMessageId: aguiPresentationMessageIdSchema,
  sessionMessageId: idSchema.nullable(),
  sessionTextPartId: idSchema.nullable(),
  resumeSegmentOrdinal: z.number().int().min(${renderInteger(message.segment.minimum)}).max(${renderInteger(message.segment.maximum)}),
  state: z.enum(${renderEnum(message.states)}),
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
  profileRevision: z.literal(${quote(run.profileRevision)}),
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
`;
}

function runCli() {
  const arguments_ = process.argv.slice(2);
  const mode = arguments_.includes("--write") ? "write" : "check";
  const rootIndex = arguments_.indexOf("--root");
  const defaultFederatedRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const federatedRoot = rootIndex === -1 ? defaultFederatedRoot : resolve(arguments_[rootIndex + 1]);
  const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const output = resolve(
    webRoot,
    "packages/session-client/src/generated/agui-binding-authority.ts",
  );
  if (!existsSync(resolve(federatedRoot, "contract/INDEX.md"))) {
    throw new Error(`Federated Root contract authority is absent: ${federatedRoot}`);
  }
  const sources = Object.fromEntries(
    aguiBindingAuthoritySources.map((relativePath) => [
      relativePath,
      readFileSync(resolve(federatedRoot, relativePath), "utf8"),
    ]),
  );
  const generated = generateAguiBindingAuthority(sources);
  if (mode === "write") {
    writeFileSync(output, generated);
    return;
  }
  if (readFileSync(output, "utf8") !== generated) {
    throw new Error("Committed AG-UI binding authority mirror is stale; run this script with --write");
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) runCli();
