#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const aguiBindingAuthoritySources = Object.freeze([
  "contract/spec/presentation-run-binding-v1.yaml",
  "contract/spec/presentation-message-binding-v1.yaml",
]);

const [runSourcePath, messageSourcePath] = aguiBindingAuthoritySources;
const idRef = Object.freeze({ $ref: "#/$defs/id" });
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

function inspectSharedDefinitions(schema, label) {
  expectKeys(schema.$defs, ["id", "dateTime"], `${label} definitions`);
  const id = expectRecord(schema.$defs.id, `${label} id definition`);
  const dateTime = expectRecord(schema.$defs.dateTime, `${label} date-time definition`);
  expectKeys(id, ["type", "minLength", "maxLength", "pattern"], `${label} id definition`);
  expectKeys(
    dateTime,
    ["type", "minLength", "maxLength", "pattern"],
    `${label} date-time definition`,
  );
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
  return { id, dateTime };
}

function inspectObjectEnvelope(schema, expectedId, required, label) {
  expectKeys(
    schema,
    [
      "$schema",
      "$id",
      "title",
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
    "internalRunRef",
    "presentationThreadId",
    "presentationRunId",
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
  for (const field of [
    "bindingRef",
    "sessionId",
    "internalRunRef",
    "presentationThreadId",
    "presentationRunId",
    "openedBySourceEventId",
  ]) {
    expectEqual(properties[field], idRef, `run binding ${field}`);
  }
  for (const field of ["resumeOfPresentationRunId", "terminalSourceEventId"]) {
    expectEqual(properties[field], { oneOf: [idRef, nullType] }, `run binding ${field}`);
  }
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
    required: ["parentInternalRunRef", "parentPresentationRunId"],
    properties: {
      parentInternalRunRef: { oneOf: [idRef, nullType] },
      parentPresentationRunId: { oneOf: [idRef, nullType] },
    },
    oneOf: [
      {
        properties: {
          parentInternalRunRef: nullType,
          parentPresentationRunId: nullType,
        },
      },
      {
        properties: {
          parentInternalRunRef: idRef,
          parentPresentationRunId: idRef,
        },
      },
    ],
  }, "run parent lineage semantics");
  expectEqual(schema.allOf, [
    {
      if: { properties: { segmentOrdinal: { const: segment.minimum } }, required: ["segmentOrdinal"] },
      then: { properties: { resumeOfPresentationRunId: nullType } },
      else: { properties: { resumeOfPresentationRunId: idRef } },
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
          terminalSourceEventId: idRef,
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
    "internalMessageRef",
    "presentationRunBindingRef",
    "presentationMessageId",
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
  for (const field of [
    "bindingRef",
    "sessionId",
    "internalMessageRef",
    "presentationRunBindingRef",
    "presentationMessageId",
    "openedBySourceEventId",
  ]) {
    expectEqual(properties[field], idRef, `message binding ${field}`);
  }
  expectEqual(properties.endedBySourceEventId, { oneOf: [idRef, nullType] }, "message ended source");
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
      if: { properties: { state: { const: "open" } }, required: ["state"] },
      then: { properties: { endedBySourceEventId: nullType, endedAt: nullType } },
      else: { properties: { endedBySourceEventId: idRef, endedAt: dateTimeRef } },
    },
  ], "message conditional semantics");

  return { profileRevision, segment, states };
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
  const runSchema = parseSource(runSource, runSourcePath);
  const messageSchema = parseSource(messageSource, messageSourcePath);
  const run = inspectRunSchema(runSchema);
  const message = inspectMessageSchema(messageSchema);
  const runDefinitions = inspectSharedDefinitions(runSchema, "run binding");
  const messageDefinitions = inspectSharedDefinitions(messageSchema, "message binding");
  expectEqual(messageDefinitions, runDefinitions, "shared definitions");
  expectEqual(message.profileRevision, run.profileRevision, "shared profile revision");
  expectEqual(message.segment, run.segment, "shared segment ordinal");

  const { id, dateTime } = runDefinitions;
  return `// GENERATED — DO NOT EDIT.
// Sources:
//   ${runSourcePath}
//   ${messageSourcePath}
// Generation authority: Kokoro Root contract authority.

import { z } from "zod";

export const aguiBindingAuthorityContractMetadata = Object.freeze({
  profileRevision: ${quote(run.profileRevision)},
  sources: Object.freeze({
    ${quote(runSourcePath)}:
      ${quote(digest(runSource))},
    ${quote(messageSourcePath)}:
      ${quote(digest(messageSource))},
  }),
});

const idPattern = ${renderRegex(id.pattern)};
const dateTimePattern = ${renderRegex(dateTime.pattern)};

const idSchema = z.string().min(${id.minLength}).max(${id.maxLength}).regex(idPattern);
const dateTimeSchema = z.string().min(${dateTime.minLength}).max(${dateTime.maxLength}).regex(dateTimePattern);

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
  profileRevision: z.literal(${quote(run.profileRevision)}),
  sessionId: idSchema,
  internalRunRef: idSchema,
  presentationThreadId: idSchema,
  presentationRunId: idSchema,
  segmentOrdinal: z.number().int().min(${renderInteger(run.segment.minimum)}).max(${renderInteger(run.segment.maximum)}),
  resumeOfPresentationRunId: idSchema.nullable(),
  parentLineage: parentLineageSchema,
  state: z.enum(${renderEnum(run.states)}),
  terminalDisposition: z.enum(${renderEnum(run.dispositions)}).nullable(),
  openedBySourceEventId: idSchema,
  terminalSourceEventId: idSchema.nullable(),
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
  bindingRef: idSchema,
  profileRevision: z.literal(${quote(message.profileRevision)}),
  sessionId: idSchema,
  internalMessageRef: idSchema,
  presentationRunBindingRef: idSchema,
  presentationMessageId: idSchema,
  resumeSegmentOrdinal: z.number().int().min(${renderInteger(message.segment.minimum)}).max(${renderInteger(message.segment.maximum)}),
  state: z.enum(${renderEnum(message.states)}),
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
