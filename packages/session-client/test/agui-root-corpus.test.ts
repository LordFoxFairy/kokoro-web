import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_PROFILE_REVISION,
  SESSION_AGUI_CONTRACT_REVISION,
  AguiPresentationProtocolError,
  createAguiPresentationDecoder,
  type AguiGrantBinding,
  type AguiPresentationDecoder,
  type AguiSseFrame,
} from "../src/agui-presentation.js";
import { readAguiPresentationSnapshotForTesting } from "../src/agui-presentation-state-machine.internal.js";

type CorpusFrame = Readonly<{
  kind: "durable";
  id: string;
  event: string;
  data: Readonly<Record<string, unknown>>;
}>;

type CorpusCase = Readonly<{
  id: string;
  snapshot: Readonly<Record<string, unknown>>;
  grantBinding: AguiGrantBinding;
  runBindings: readonly Readonly<Record<string, unknown>>[];
  messageBindings: readonly Readonly<Record<string, unknown>>[];
  frames: readonly CorpusFrame[];
  expectedFinalSnapshot: Readonly<Record<string, unknown>>;
}>;

type NegativeCase = Readonly<{
  id: string;
  baseCaseId: string;
  mutation: Readonly<{
    operation: string;
    path?: string;
    value?: unknown;
    runBindingRef?: string;
    messageBindingRef?: string;
  }>;
  expectedCode: string;
}>;

type SnapshotAuthorityCase = Readonly<{
  id: string;
  baseCaseId: string;
  nextEventRecordedAt: string;
  snapshot: Readonly<Record<string, unknown>>;
}>;

type SnapshotNegativeCase = Readonly<{
  id: string;
  baseAuthorityCaseId: string;
  mutation: Readonly<{ operation: string }>;
  expectedCode: string;
}>;

type Corpus = Readonly<{
  corpusId: string;
  profileRevision: string;
  positiveCases: readonly CorpusCase[];
  negativeCases: readonly NegativeCase[];
  snapshotAuthorityCases: readonly SnapshotAuthorityCase[];
  snapshotAuthorityNegativeCases: readonly SnapshotNegativeCase[];
}>;

const corpusFixture = new URL("./fixtures/root-agui-presentation-v1.json", import.meta.url);
const corpusSource = readFileSync(corpusFixture);
const corpus = JSON.parse(corpusSource.toString("utf8")) as Corpus;
const ROOT_CORPUS_SHA256 = "060f7d010be7ac38652f1f31be15855c73468283f865062aafc8e37b87a18712";

function zeroSnapshot(contractCase: CorpusCase): Readonly<Record<string, unknown>> {
  return {
    ...contractCase.snapshot,
    runBindings: [],
    messageBindings: [],
    ownerBindings: [],
    ownerProjectionRows: [],
  };
}

function decoderFor(contractCase: CorpusCase): AguiPresentationDecoder {
  return createAguiPresentationDecoder({
    grant: contractCase.grantBinding,
    snapshotAuthority: zeroSnapshot(contractCase),
  });
}

function toSse(frame: CorpusFrame): AguiSseFrame {
  return { id: frame.id, event: frame.event, data: JSON.stringify(frame.data) };
}

function admit(decoder: AguiPresentationDecoder, frame: CorpusFrame): void {
  decoder.prepare(toSse(frame)).commit("applied");
}

function expectCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AguiPresentationProtocolError);
    expect((error as AguiPresentationProtocolError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

function setAtPath(value: unknown, path: string, replacement: unknown): void {
  const segments = path.split(".");
  let cursor = value;
  for (const segment of segments.slice(0, -1)) {
    if (cursor === null || typeof cursor !== "object" || !(segment in cursor)) {
      throw new Error(`Invalid Root corpus mutation path: ${path}`);
    }
    cursor = Reflect.get(cursor, segment);
  }
  if (cursor === null || typeof cursor !== "object") throw new Error(`Invalid Root corpus mutation path: ${path}`);
  Reflect.set(cursor, segments.at(-1) ?? "", structuredClone(replacement));
}

function bindingRefAt(base: CorpusCase, path: string): string {
  const match = /^(runBindings|messageBindings)\.([0-9]+)\./u.exec(path);
  const bindings = match?.[1] === "runBindings" ? base.runBindings : base.messageBindings;
  const binding = match === null ? undefined : bindings[Number.parseInt(match[2] ?? "", 10)];
  const bindingRef = binding?.["bindingRef"];
  if (typeof bindingRef !== "string") throw new Error(`Root binding path missing: ${path}`);
  return bindingRef;
}

function terminalDeltaFrame(base: CorpusCase, bindingRef: string): CorpusFrame {
  const frame = base.frames.find(({ data }) => {
    const delta = data["bindingAuthorityDelta"];
    if (delta === null || typeof delta !== "object") return false;
    const binding = Reflect.get(delta, "binding");
    return binding !== null && typeof binding === "object" &&
      Reflect.get(binding, "bindingRef") === bindingRef && Reflect.get(binding, "terminalAt") !== null;
  });
  if (frame === undefined) throw new Error(`Root terminal delta missing: ${bindingRef}`);
  return frame;
}

function frameAttack(base: CorpusCase, attack: NegativeCase): readonly CorpusFrame[] {
  const frames = structuredClone(base.frames) as CorpusFrame[];
  if (attack.mutation.operation === "set") {
    const path = attack.mutation.path;
    if (path === undefined) throw new Error(`Root mutation path missing: ${attack.id}`);
    if (path.startsWith("frames.")) {
      setAtPath({ frames }, path, attack.mutation.value);
      return frames;
    }
    if (path.startsWith("runBindings.") || path.startsWith("messageBindings.")) {
      const bindingRef = bindingRefAt(base, path);
      const target = attack.id === "m0-interrupted-main-run"
        ? terminalDeltaFrame(base, bindingRef)
        : frames.find(({ data }) => {
          const delta = data["bindingAuthorityDelta"];
          return delta !== null && typeof delta === "object" &&
            Reflect.get(Reflect.get(delta, "binding") ?? {}, "bindingRef") === bindingRef;
        });
      if (target === undefined) throw new Error(`Root binding delta missing: ${attack.id}`);
      const targetIndex = frames.findIndex(({ id }) => id === target.id);
      const suffix = path.split(".").slice(2).join(".");
      setAtPath(frames[targetIndex], `data.bindingAuthorityDelta.binding.${suffix}`, attack.mutation.value);
      return frames;
    }
    throw new Error(`Root-private mutation is not a browser frame: ${attack.id}`);
  }

  const eventName = attack.mutation.operation === "terminal-revival" ? "RUN_STARTED" : "TEXT_MESSAGE_CONTENT";
  const sourceFrame = frames.find(({ event, data }) =>
    event === eventName && (
      attack.mutation.operation === "terminal-revival"
        ? data["presentationRunBindingRef"] === attack.mutation.runBindingRef
        : data["presentationMessageBindingRef"] === attack.mutation.messageBindingRef
    ));
  const lastFrame = frames.at(-1);
  if (sourceFrame === undefined || lastFrame === undefined) throw new Error(`Root attack frame missing: ${attack.id}`);
  const appended = structuredClone(sourceFrame) as CorpusFrame;
  const lastSource = lastFrame.data["source"];
  const source = appended.data["source"];
  const event = appended.data["event"];
  if (
    lastSource === null || typeof lastSource !== "object" ||
    source === null || typeof source !== "object" ||
    event === null || typeof event !== "object"
  ) throw new Error(`Root attack payload missing: ${attack.id}`);
  const nextSeq = (BigInt(String(Reflect.get(lastSource, "durableSeq"))) + 1n).toString();
  const nextTime = new Date(Date.parse(String(Reflect.get(lastSource, "recordedAt"))) + 1_000).toISOString();
  Reflect.set(source, "sourceEventId", `presentation.event:${attack.mutation.operation === "terminal-revival" ? "a" : "b".repeat(64)}`);
  Reflect.set(source, "durableSeq", nextSeq);
  Reflect.set(source, "projectionVersion", nextSeq);
  Reflect.set(source, "recordedAt", nextTime);
  Reflect.set(event, "timestamp", Date.parse(nextTime));
  Reflect.set(appended, "id", `opaque.attack.cursor.${nextSeq}.${attack.mutation.operation}`);
  frames.push(appended);
  return frames;
}

function mutateSnapshot(base: Readonly<Record<string, unknown>>, operation: string): Readonly<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = { ...structuredClone(base) };
  const runs = snapshot["runBindings"];
  if (!Array.isArray(runs)) throw new Error(`Root snapshot bindings missing: ${operation}`);
  if (operation === "zero-head-retains-bindings") {
    snapshot["durableSeq"] = "0";
    snapshot["lastRecordedAt"] = null;
  } else if (operation === "binding-evidence-exceeds-head") {
    snapshot["durableSeq"] = "1";
  } else if (operation === "noncanonical-binding-time") {
    Reflect.set(runs[0], "openedAt", "2026-08-01T13:00:01Z");
  } else if (operation === "multiple-presentation-thread") {
    Reflect.set(runs[1], "presentationThreadId", `presentation.thread:${"f".repeat(64)}`);
  } else if (operation === "parent-lineage-cycle") {
    const childId = Reflect.get(runs[1], "presentationRunId");
    Reflect.set(Reflect.get(runs[0], "parentLineage"), "parentPresentationRunId", childId);
  } else if (operation === "m0-interrupted-terminal") {
    Reflect.set(runs[0], "terminalDisposition", "interrupted");
  } else {
    throw new Error(`Unknown Root snapshot mutation: ${operation}`);
  }
  return snapshot;
}

function terminalOwnerRevivalFrame(authorityCase: SnapshotAuthorityCase): AguiSseFrame {
  const snapshot = structuredClone(authorityCase.snapshot) as Record<string, unknown>;
  const rows = snapshot["ownerProjectionRows"];
  const bindings = snapshot["ownerBindings"];
  if (!Array.isArray(rows) || !Array.isArray(bindings)) throw new Error("Root owner authority missing");
  const current = rows.find((row) => Reflect.get(Reflect.get(row, "event"), "activityType") === "kokoro.safe-summary.v1");
  if (current === undefined) throw new Error("Root terminal owner missing");
  const bindingRef = Reflect.get(current, "presentationOwnerBindingRef");
  const binding = bindings.find((candidate) => Reflect.get(candidate, "bindingRef") === bindingRef);
  if (binding === undefined) throw new Error("Root terminal owner binding missing");
  const durableSeq = (BigInt(String(snapshot["durableSeq"])) + 1n).toString();
  const event = structuredClone(Reflect.get(current, "event")) as Record<string, unknown>;
  const content = Reflect.get(event, "content") as Record<string, unknown>;
  event["timestamp"] = Date.parse(authorityCase.nextEventRecordedAt);
  content["ownerVersion"] = "2";
  content["status"] = "streaming";
  content["updatedAt"] = authorityCase.nextEventRecordedAt;
  const data = {
    profileRevision: snapshot["profileRevision"],
    source: {
      sourceEventId: `presentation.event:${"f".repeat(64)}`,
      sourceKind: "presentation.activity.safe-summary",
      sessionId: snapshot["sessionId"],
      streamEpoch: snapshot["streamEpoch"],
      durableSeq,
      projectionVersion: durableSeq,
      schemaRevision: 1,
      recordedAt: authorityCase.nextEventRecordedAt,
    },
    presentationRunBindingRef: Reflect.get(binding, "presentationRunBindingRef"),
    ...(Reflect.get(binding, "presentationMessageBindingRef") === null
      ? {}
      : { presentationMessageBindingRef: Reflect.get(binding, "presentationMessageBindingRef") }),
    presentationOwnerBindingRef: bindingRef,
    bindingAuthorityDelta: { kind: "owner.replace", binding },
    event,
  };
  return { id: `opaque.snapshot.attack.${durableSeq}`, event: "ACTIVITY_SNAPSHOT", data: JSON.stringify(data) };
}

describe("Root AG-UI conformance corpus mirror", () => {
  it("is the exact pinned Root corpus bytes", () => {
    expect(createHash("sha256").update(corpusSource).digest("hex")).toBe(ROOT_CORPUS_SHA256);
    const rootCorpus = new URL("../../../../contract/corpus/agui-presentation-v1.json", import.meta.url);
    if (existsSync(rootCorpus)) expect(readFileSync(rootCorpus).equals(corpusSource)).toBe(true);
    expect(corpus).toMatchObject({
      corpusId: "kokoro.agui.presentation-conformance.v1",
      profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
    });
  });

  it("rebuilds every Root final snapshot from a real empty sequence-zero snapshot", () => {
    for (const contractCase of corpus.positiveCases) {
      const decoder = decoderFor(contractCase);
      for (const frame of contractCase.frames) admit(decoder, frame);
      expect(readAguiPresentationSnapshotForTesting(decoder)).toEqual(contractCase.expectedFinalSnapshot);
    }
  });

  it("reports a registered source/discriminator mismatch distinctly from a missing mapping", () => {
    const base = corpus.positiveCases[0];
    if (base === undefined) throw new Error("Root corpus case missing");
    const frames = structuredClone(base.frames) as CorpusFrame[];
    const customSession = frames.find(({ data }) => {
      const event = data["event"];
      return event !== null && typeof event === "object" &&
        Reflect.get(event, "name") === "kokoro.session.replace.v1";
    });
    const source = customSession?.data["source"];
    if (source === null || typeof source !== "object") throw new Error("Root CUSTOM source missing");
    Reflect.set(source, "sourceKind", "presentation.custom.branch");
    expectCode(() => {
      const decoder = decoderFor(base);
      for (const frame of frames) admit(decoder, frame);
    }, "agui_mapping_discriminator_conflict");
  });

  it("validates terminal delta facts before complete-replacement continuity", () => {
    const base = corpus.positiveCases[0];
    if (base === undefined) throw new Error("Root corpus case missing");
    const runTerminalIndex = base.frames.findIndex(({ event }) => event === "RUN_FINISHED");
    const messageTerminalIndex = base.frames.findIndex(({ event }) => event === "TEXT_MESSAGE_END");
    if (runTerminalIndex < 0 || messageTerminalIndex < 0) throw new Error("Root terminal frames missing");

    const cases: readonly Readonly<{
      id: string;
      frameIndex: number;
      expectedCode: string;
      mutate(frame: CorpusFrame): void;
    }>[] = [
      {
        id: "run-source",
        frameIndex: runTerminalIndex,
        expectedCode: "agui_binding_delta_source_conflict",
        mutate(frame) {
          setAtPath(frame, "data.bindingAuthorityDelta.binding.terminalSourceEventId", `presentation.event:${"c".repeat(64)}`);
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "run-time",
        frameIndex: runTerminalIndex,
        expectedCode: "agui_binding_delta_time_conflict",
        mutate(frame) {
          setAtPath(frame, "data.bindingAuthorityDelta.binding.terminalAt", "2026-08-01T12:00:20.000Z");
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "run-state",
        frameIndex: runTerminalIndex,
        expectedCode: "agui_binding_delta_state_conflict",
        mutate(frame) {
          setAtPath(frame, "data.bindingAuthorityDelta.binding.state", "error");
          setAtPath(frame, "data.bindingAuthorityDelta.binding.terminalDisposition", "error");
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "run-event",
        frameIndex: runTerminalIndex,
        expectedCode: "agui_binding_delta_event_identity_conflict",
        mutate(frame) {
          setAtPath(frame, "data.event.runId", `presentation.run:${"d".repeat(64)}`);
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "run-replacement",
        frameIndex: runTerminalIndex,
        expectedCode: "agui_binding_delta_replacement_conflict",
        mutate(frame) {
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "message-source",
        frameIndex: messageTerminalIndex,
        expectedCode: "agui_binding_delta_source_conflict",
        mutate(frame) {
          setAtPath(frame, "data.bindingAuthorityDelta.binding.endedBySourceEventId", `presentation.event:${"e".repeat(64)}`);
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "message-time",
        frameIndex: messageTerminalIndex,
        expectedCode: "agui_binding_delta_time_conflict",
        mutate(frame) {
          setAtPath(frame, "data.bindingAuthorityDelta.binding.endedAt", "2026-08-01T12:00:19.000Z");
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "message-event",
        frameIndex: messageTerminalIndex,
        expectedCode: "agui_binding_delta_event_identity_conflict",
        mutate(frame) {
          setAtPath(frame, "data.event.messageId", `presentation.message:${"f".repeat(64)}`);
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
      {
        id: "message-replacement",
        frameIndex: messageTerminalIndex,
        expectedCode: "agui_binding_delta_replacement_conflict",
        mutate(frame) {
          setAtPath(frame, "data.bindingAuthorityDelta.binding.openedAt", "2026-08-01T11:59:59.000Z");
        },
      },
    ];

    for (const attack of cases) {
      const frames = structuredClone(base.frames) as CorpusFrame[];
      const target = frames[attack.frameIndex];
      if (target === undefined) throw new Error(`Root terminal attack missing: ${attack.id}`);
      attack.mutate(target);
      expectCode(() => {
        const decoder = decoderFor(base);
        for (const frame of frames) admit(decoder, frame);
      }, attack.expectedCode);
    }
  });

  it("keeps the entire decoder state unchanged until acknowledgement succeeds", () => {
    const contractCase = corpus.positiveCases[0];
    const firstFrame = contractCase?.frames[0];
    if (contractCase === undefined || firstFrame === undefined) throw new Error("Root corpus case missing");
    const decoder = decoderFor(contractCase);
    const candidate = toSse(firstFrame);
    const prepared = decoder.prepare(candidate);
    expectCode(() => Reflect.apply(prepared.commit, prepared, ["not-applied"]), "agui_dispatch_ack_invalid");
    expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe("0");
    expect(decoder.prepare(candidate)).toBe(prepared);
    prepared.commit("applied");
    expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe("1");
  });

  it("requires Session snapshot authority even at sequence zero", () => {
    const base = corpus.positiveCases[0];
    if (base === undefined) throw new Error("Root corpus case missing");
    expectCode(() => Reflect.apply(createAguiPresentationDecoder, undefined, [{
      grant: {
        sessionId: String(base.snapshot["sessionId"]),
        sessionContractRevision: SESSION_AGUI_CONTRACT_REVISION,
        presentationProfileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
      },
    }]), "agui_snapshot_authority_required");
  });

  it("accepts every Root nonzero Session snapshot authority", () => {
    for (const authorityCase of corpus.snapshotAuthorityCases) {
      const base = corpus.positiveCases.find(({ id }) => id === authorityCase.baseCaseId);
      if (base === undefined) throw new Error(`Root authority base missing: ${authorityCase.id}`);
      expect(createAguiPresentationDecoder({
        grant: base.grantBinding,
        snapshotAuthority: authorityCase.snapshot,
      }).getResumeRequest().cursorBinding.durableSeq).toBe(authorityCase.snapshot["durableSeq"]);
    }
  });

  it("rejects every browser-facing Root attack with its contract code", () => {
    const browserAttacks = corpus.negativeCases.filter(({ mutation }) =>
      mutation.path?.startsWith("sessionPrivateRouteFixtures.") !== true);
    expect(browserAttacks).toHaveLength(corpus.negativeCases.length - 1);
    for (const attack of browserAttacks) {
      const base = corpus.positiveCases.find(({ id }) => id === attack.baseCaseId);
      if (base === undefined) throw new Error(`Root negative base missing: ${attack.id}`);
      const frames = frameAttack(base, attack);
      expectCode(() => {
        const decoder = decoderFor(base);
        for (const frame of frames) admit(decoder, frame);
      }, attack.expectedCode);
    }
  });

  it("keeps the sole Root-private provenance attack outside browser topology", () => {
    const privateAttacks = corpus.negativeCases.filter(({ mutation }) =>
      mutation.path?.startsWith("sessionPrivateRouteFixtures.") === true);
    expect(privateAttacks).toEqual([
      expect.objectContaining({
        id: "public-source-private-ref-equality",
        expectedCode: "agui_private_provenance_identity_equal",
      }),
    ]);
  });

  it("rejects every Root snapshot-authority attack with its contract code", () => {
    for (const attack of corpus.snapshotAuthorityNegativeCases) {
      const authorityCase = corpus.snapshotAuthorityCases.find(({ id }) => id === attack.baseAuthorityCaseId);
      if (authorityCase === undefined) throw new Error(`Root snapshot base missing: ${attack.id}`);
      const base = corpus.positiveCases.find(({ id }) => id === authorityCase.baseCaseId);
      if (base === undefined) throw new Error(`Root snapshot grant missing: ${attack.id}`);
      if (attack.mutation.operation === "snapshot-terminal-owner-revival") {
        const decoder = createAguiPresentationDecoder({
          grant: base.grantBinding,
          snapshotAuthority: authorityCase.snapshot,
        });
        expectCode(() => decoder.prepare(terminalOwnerRevivalFrame(authorityCase)), attack.expectedCode);
      } else {
        expectCode(() => createAguiPresentationDecoder({
          grant: base.grantBinding,
          snapshotAuthority: mutateSnapshot(authorityCase.snapshot, attack.mutation.operation),
        }), attack.expectedCode);
      }
    }
  });
});
