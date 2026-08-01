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

type CorpusSnapshot = Readonly<{
  authority: string;
  hydrate: boolean;
  repair: boolean;
  profileRevision: string;
  sessionId: string;
  streamEpoch: string;
  durableSeq: string;
  cursor: string;
}>;

type CorpusFrame = Readonly<{
  kind: "durable";
  id: string;
  event: string;
  data: Readonly<Record<string, unknown>>;
}>;

type CorpusCase = Readonly<{
  id: string;
  snapshot: CorpusSnapshot;
  grantBinding: AguiGrantBinding;
  runBindings: readonly unknown[];
  messageBindings: readonly unknown[];
  frames: readonly CorpusFrame[];
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

type Corpus = Readonly<{
  corpusId: string;
  profileRevision: string;
  positiveCases: readonly CorpusCase[];
  negativeCases: readonly NegativeCase[];
}>;

const corpusFixture = new URL("./fixtures/root-agui-presentation-v1.json", import.meta.url);
const corpusSource = readFileSync(corpusFixture);
const corpus = JSON.parse(corpusSource.toString("utf8")) as Corpus;
const ROOT_CORPUS_SHA256 = "296897c3f61cfd8f906898b6d21277b21d6cb02d06503913695ae8741468397f";

function snapshotAuthority(contractCase: CorpusCase): Readonly<Record<string, unknown>> {
  return {
    ...contractCase.snapshot,
    runBindings: contractCase.runBindings,
    messageBindings: contractCase.messageBindings,
  };
}

function createCorpusDecoder(contractCase: CorpusCase): AguiPresentationDecoder {
  return createAguiPresentationDecoder({
    grant: contractCase.grantBinding,
    snapshotAuthority: snapshotAuthority(contractCase),
  });
}

function admit(decoder: AguiPresentationDecoder, corpusFrame: CorpusFrame): void {
  const frame: AguiSseFrame = {
    id: corpusFrame.id,
    event: corpusFrame.event,
    data: JSON.stringify(corpusFrame.data),
  };
  const prepared = decoder.prepare(frame);
  prepared.commit("applied");
}

function liveSessionFrame(
  base: CorpusCase,
  sourceEventId: string,
  recordedAt: string,
): CorpusFrame {
  return {
    kind: "durable",
    id: "opaque.live.cursor.0010",
    event: "CUSTOM",
    data: {
      profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
      source: {
        sourceEventId,
        sourceKind: "presentation.custom.session",
        sessionId: base.snapshot.sessionId,
        streamEpoch: base.snapshot.streamEpoch,
        durableSeq: "10",
        projectionVersion: 10,
        schemaRevision: 1,
        recordedAt,
      },
      event: {
        type: "CUSTOM",
        timestamp: Date.parse(recordedAt),
        name: "kokoro.session.replace.v1",
        value: {
          sessionId: base.snapshot.sessionId,
          profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
          title: "Resumed",
          lifecycle: "active",
          contextPolicy: "standard",
          activeBranchId: "branch.01",
          version: 2,
        },
      },
    },
  };
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
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  if (cursor === null || typeof cursor !== "object") throw new Error(`Invalid Root corpus mutation path: ${path}`);
  (cursor as Record<string, unknown>)[segments.at(-1) ?? ""] = structuredClone(replacement);
}

function applyRootMutation(base: CorpusCase, attack: NegativeCase): CorpusCase {
  const candidate = structuredClone(base) as unknown as {
    runBindings: Array<Record<string, unknown>>;
    frames: Array<{
      kind: "durable";
      id: string;
      event: string;
      data: Record<string, unknown>;
    }>;
  };
  if (attack.mutation.operation === "set") {
    if (attack.mutation.path === undefined) throw new Error(`Root mutation path missing: ${attack.id}`);
    setAtPath(candidate, attack.mutation.path, attack.mutation.value);
    if (attack.mutation.path.endsWith("parentLineage.parentPresentationRunId")) {
      const bindingIndex = Number.parseInt(attack.mutation.path.split(".")[1] ?? "", 10);
      const parent = candidate.runBindings.find((binding) =>
        binding["presentationRunId"] === attack.mutation.value);
      const target = candidate.runBindings[bindingIndex];
      const lineage = target?.["parentLineage"];
      if (lineage !== null && typeof lineage === "object") {
        (lineage as Record<string, unknown>)["parentInternalRunRef"] = parent?.["internalRunRef"] ?? null;
      }
    }
    return candidate as unknown as CorpusCase;
  }

  const expectedEvent = attack.mutation.operation === "terminal-revival" ? "RUN_STARTED" : "TEXT_MESSAGE_CONTENT";
  const baseFrame = candidate.frames.find((frame) =>
    frame.event === expectedEvent &&
    (attack.mutation.operation === "terminal-revival"
      ? frame.data["presentationRunBindingRef"] === attack.mutation.runBindingRef
      : frame.data["presentationMessageBindingRef"] === attack.mutation.messageBindingRef));
  const last = candidate.frames.at(-1);
  if (baseFrame === undefined || last === undefined) throw new Error(`Root attack frame missing: ${attack.id}`);
  const frame = structuredClone(baseFrame);
  const lastSource = last.data["source"] as Record<string, unknown>;
  const source = frame.data["source"] as Record<string, unknown>;
  const event = frame.data["event"] as Record<string, unknown>;
  const nextSeq = (BigInt(String(lastSource["durableSeq"])) + 1n).toString();
  const recordedAt = "2026-08-01T12:00:27.000Z";
  source["sourceEventId"] = attack.mutation.operation === "terminal-revival"
    ? "attack.source.terminal-revival"
    : "attack.source.message-reopen";
  source["sourceKind"] = attack.mutation.operation === "terminal-revival"
    ? "presentation.run.started"
    : "presentation.message.text.content";
  source["durableSeq"] = nextSeq;
  source["projectionVersion"] = Number(source["projectionVersion"]) + 1;
  source["recordedAt"] = recordedAt;
  event["timestamp"] = Date.parse(recordedAt);
  frame.id = `opaque.attack.cursor.${nextSeq}.${attack.mutation.operation}`;
  candidate.frames.push(frame);
  return candidate as unknown as CorpusCase;
}

describe("Root AG-UI conformance corpus mirror", () => {
  it("is the exact pinned Root corpus bytes in a federated checkout", () => {
    expect(createHash("sha256").update(corpusSource).digest("hex")).toBe(ROOT_CORPUS_SHA256);
    const rootCorpus = new URL("../../../../contract/corpus/agui-presentation-v1.json", import.meta.url);
    if (existsSync(rootCorpus)) {
      expect(readFileSync(rootCorpus).equals(corpusSource)).toBe(true);
    }
  });

  it("keeps the exact Root corpus identity and positive owner baselines 2/3/4", () => {
    expect(corpus.corpusId).toBe("kokoro.agui.presentation-conformance.v1");
    expect(corpus.profileRevision).toBe(AGUI_PRESENTATION_PROFILE_REVISION);
    const primary = corpus.positiveCases.find(({ id }) => id === "resume-with-safe-typed-presentation");
    if (primary === undefined) throw new Error("Root primary corpus case missing");
    const customVersions = primary.frames
      .map(({ data }) => data.event)
      .filter((event): event is Readonly<Record<string, unknown>> => event !== null && typeof event === "object")
      .filter(({ type }) => type === "CUSTOM")
      .map(({ value }) => value)
      .filter((value): value is Readonly<Record<string, unknown>> => value !== null && typeof value === "object")
      .flatMap((value) => [value.version, value.projectionVersion])
      .filter((version): version is number => typeof version === "number");
    expect(customVersions).toEqual(expect.arrayContaining([2, 3, 4]));
  });

  it("replays every Root positive frame without rewriting owner versions", () => {
    for (const contractCase of corpus.positiveCases) {
      expect(contractCase.snapshot).toMatchObject({
        authority: "session-browser-v3-http-snapshot",
        hydrate: true,
        repair: true,
      });
      const decoder = createCorpusDecoder(contractCase);
      for (const frame of contractCase.frames) admit(decoder, frame);
      expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe(
        contractCase.frames.at(-1)?.data.source !== null &&
        typeof contractCase.frames.at(-1)?.data.source === "object"
          ? (contractCase.frames.at(-1)?.data.source as Readonly<Record<string, unknown>>).durableSeq
          : undefined,
      );
    }
  });

  it("requires snapshot binding authority even for the zero cursor", () => {
    const contractCase = corpus.positiveCases[0];
    if (contractCase === undefined) throw new Error("Root corpus case missing");
    expectCode(
      () => createAguiPresentationDecoder({
        grant: {
          sessionId: contractCase.snapshot.sessionId,
          sessionContractRevision: SESSION_AGUI_CONTRACT_REVISION,
          presentationProfileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
          cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
        },
      } as unknown as Parameters<typeof createAguiPresentationDecoder>[0]),
      "agui_snapshot_authority_required",
    );
  });

  it("seeds snapshot binding source identities and evidence time before a nonzero resume", () => {
    const base = corpus.positiveCases[0];
    const firstRun = base?.runBindings[0] as { openedBySourceEventId?: string } | undefined;
    if (base === undefined || firstRun?.openedBySourceEventId === undefined) {
      throw new Error("Root corpus snapshot evidence missing");
    }
    const openedBySourceEventId = firstRun.openedBySourceEventId;
    const resumedAuthority = {
      ...snapshotAuthority(base),
      durableSeq: "9",
      cursor: "opaque.snapshot.cursor.0009",
    };

    const reused = createAguiPresentationDecoder({ grant: base.grantBinding, snapshotAuthority: resumedAuthority });
    expectCode(
      () => admit(reused, liveSessionFrame(base, openedBySourceEventId, "2026-08-01T12:00:27.000Z")),
      "agui_stream_identity_duplicate",
    );
    expect(reused.getResumeRequest().cursorBinding.durableSeq).toBe("9");

    const regressed = createAguiPresentationDecoder({ grant: base.grantBinding, snapshotAuthority: resumedAuthority });
    expectCode(
      () => admit(regressed, liveSessionFrame(base, "source.live.10", "2026-08-01T12:00:00.000Z")),
      "agui_event_time_invalid",
    );
    expect(regressed.getResumeRequest().cursorBinding.durableSeq).toBe("9");

    expectCode(
      () => createAguiPresentationDecoder({
        grant: base.grantBinding,
        snapshotAuthority: resumedAuthority,
        limits: { streamIdentities: 2 },
      }),
      "agui_authority_capacity_exceeded",
    );
    expectCode(
      () => createAguiPresentationDecoder({
        grant: base.grantBinding,
        snapshotAuthority: resumedAuthority,
        limits: { streamIdentities: 8 },
      }),
      "agui_authority_capacity_exceeded",
    );
  });

  it("rejects a terminal Run snapshot that still owns an open message", () => {
    const base = corpus.positiveCases[0];
    if (base === undefined) throw new Error("Root corpus case missing");
    const candidate = structuredClone(base);
    const message = candidate.messageBindings[1] as {
      state: string;
      endedBySourceEventId: string | null;
      endedAt: string | null;
    };
    message.state = "open";
    message.endedBySourceEventId = null;
    message.endedAt = null;
    expectCode(() => createCorpusDecoder(candidate), "agui_run_message_open");
  });

  it("rejects message evidence outside its owning Run time interval", () => {
    const base = corpus.positiveCases[0];
    if (base === undefined) throw new Error("Root corpus case missing");
    const beforeRun = structuredClone(base);
    (beforeRun.messageBindings[0] as { openedAt: string }).openedAt = "2026-08-01T12:00:00.000Z";
    expectCode(() => createCorpusDecoder(beforeRun), "agui_message_binding_time_invalid");

    const afterRun = structuredClone(base);
    (afterRun.messageBindings[0] as { endedAt: string }).endedAt = "2026-08-01T12:00:22.000Z";
    expectCode(() => createCorpusDecoder(afterRun), "agui_message_binding_time_invalid");
  });

  it("normalizes hostile snapshot accessors and proxies to protocol errors", () => {
    const base = corpus.positiveCases[0];
    if (base === undefined) throw new Error("Root corpus case missing");
    let getterCalls = 0;
    const accessor = Object.create(Object.prototype, {
      ...Object.fromEntries(Object.entries(snapshotAuthority(base)).map(([key, value]) => [
        key,
        { enumerable: true, value },
      ])),
      runBindings: {
        enumerable: true,
        get() {
          getterCalls += 1;
          throw new Error("hostile getter");
        },
      },
    });
    expectCode(
      () => createAguiPresentationDecoder({ grant: base.grantBinding, snapshotAuthority: accessor }),
      "agui_snapshot_authority_invalid",
    );
    expect(getterCalls).toBe(0);

    const proxy = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("hostile proxy");
      },
    });
    expectCode(
      () => createAguiPresentationDecoder({ grant: base.grantBinding, snapshotAuthority: proxy }),
      "agui_snapshot_authority_invalid",
    );

    const oversizedNestedArrayTarget: unknown[] = [];
    oversizedNestedArrayTarget.length = 513;
    let oversizedOwnKeysCalls = 0;
    const oversizedNestedArray = new Proxy(oversizedNestedArrayTarget, {
      ownKeys(target) {
        oversizedOwnKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
    });
    const oversizedGraph = structuredClone(snapshotAuthority(base));
    const runBindings = oversizedGraph["runBindings"];
    if (!Array.isArray(runBindings) || runBindings[0] === null || typeof runBindings[0] !== "object") {
      throw new Error("Root corpus run binding missing");
    }
    (runBindings[0] as Record<string, unknown>).hostile = oversizedNestedArray;
    expectCode(
      () => createAguiPresentationDecoder({ grant: base.grantBinding, snapshotAuthority: oversizedGraph }),
      "agui_authority_capacity_exceeded",
    );
    expect(oversizedOwnKeysCalls).toBe(0);

    let oversizedEnvelopeDescriptorCalls = 0;
    const oversizedEnvelope = new Proxy({}, {
      getOwnPropertyDescriptor(_target, property) {
        oversizedEnvelopeDescriptorCalls += 1;
        return { configurable: true, enumerable: true, value: property };
      },
      ownKeys() {
        return Array.from({ length: 11 }, (_, index) => `field${index}`);
      },
    });
    expectCode(
      () => createAguiPresentationDecoder({ grant: base.grantBinding, snapshotAuthority: oversizedEnvelope }),
      "agui_snapshot_authority_invalid",
    );
    expect(oversizedEnvelopeDescriptorCalls).toBe(0);

    let sharedFanout: unknown = "leaf";
    for (let level = 0; level < 3; level += 1) {
      sharedFanout = Object.fromEntries(
        Array.from({ length: 32 }, (_, index) => [`branch${index}`, sharedFanout]),
      );
    }
    const amplifiedGraph = structuredClone(snapshotAuthority(base));
    const amplifiedRunBindings = amplifiedGraph["runBindings"];
    if (
      !Array.isArray(amplifiedRunBindings) ||
      amplifiedRunBindings[0] === null ||
      typeof amplifiedRunBindings[0] !== "object"
    ) {
      throw new Error("Root corpus run binding missing");
    }
    (amplifiedRunBindings[0] as Record<string, unknown>).hostile = sharedFanout;
    expectCode(
      () => createAguiPresentationDecoder({ grant: base.grantBinding, snapshotAuthority: amplifiedGraph }),
      "agui_authority_capacity_exceeded",
    );
  });

  it("does not admit an untrusted Run binding from an empty zero snapshot", () => {
    const base = corpus.positiveCases[0];
    const firstFrame = base?.frames[0];
    if (base === undefined || firstFrame === undefined) throw new Error("Root corpus case missing");
    const decoder = createAguiPresentationDecoder({
      grant: base.grantBinding,
      snapshotAuthority: {
        ...base.snapshot,
        runBindings: [],
        messageBindings: [],
      },
    });
    expectCode(() => admit(decoder, firstFrame), "agui_run_binding_authority_missing");
    expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe("0");
  });

  it("does not create an unknown message ledger under a trusted Run", () => {
    const base = corpus.positiveCases[0];
    const runStart = base?.frames[0];
    const messageStart = base?.frames[1];
    if (base === undefined || runStart === undefined || messageStart === undefined) {
      throw new Error("Root corpus message chain missing");
    }
    const decoder = createCorpusDecoder(base);
    admit(decoder, runStart);
    const attack = structuredClone(messageStart) as {
      kind: "durable";
      id: string;
      event: string;
      data: Record<string, unknown>;
    };
    attack.data["presentationMessageBindingRef"] = "message-binding.untrusted";
    expectCode(() => admit(decoder, attack), "agui_message_binding_authority_missing");
    expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe("1");
  });

  it("rejects a trusted message binding presented under a different trusted Run", () => {
    const base = corpus.positiveCases[0];
    const runStart = base?.frames[0];
    const messageStart = base?.frames[1];
    if (base === undefined || runStart === undefined || messageStart === undefined) {
      throw new Error("Root corpus message chain missing");
    }
    const decoder = createCorpusDecoder(base);
    admit(decoder, runStart);
    const attack = structuredClone(messageStart) as {
      kind: "durable";
      id: string;
      event: string;
      data: Record<string, unknown>;
    };
    attack.data["presentationRunBindingRef"] = "run-binding.01.segment.1";
    expectCode(() => admit(decoder, attack), "agui_frame_message_binding_invalid");
    expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe("1");
  });

  it("replays the Root parent-lineage attack against constructor authority", () => {
    const attack = corpus.negativeCases.find(({ id }) => id === "resume-parent-lineage-confusion");
    const base = corpus.positiveCases.find(({ id }) => id === attack?.baseCaseId);
    if (attack === undefined || base === undefined || attack.mutation.path === undefined) {
      throw new Error("Root lineage attack missing");
    }
    const candidate = structuredClone(base);
    const target = candidate.runBindings[1] as {
      parentLineage: { parentInternalRunRef: string | null; parentPresentationRunId: string | null };
    };
    target.parentLineage.parentPresentationRunId = String(attack.mutation.value);
    const parent = candidate.runBindings.find((binding) =>
      (binding as { presentationRunId?: string }).presentationRunId === attack.mutation.value) as
      { internalRunRef?: string } | undefined;
    target.parentLineage.parentInternalRunRef = parent?.internalRunRef ?? null;
    expectCode(() => createCorpusDecoder(candidate), attack.expectedCode);
  });

  it("rejects a pattern-valid but impossible binding timestamp at construction", () => {
    const base = corpus.positiveCases[0];
    if (base === undefined) throw new Error("Root corpus case missing");
    const candidate = structuredClone(base);
    const run = candidate.runBindings[0] as { openedAt: string };
    run.openedAt = "2026-99-99T12:00:00.000Z";
    expectCode(() => createCorpusDecoder(candidate), "agui_run_binding_time_invalid");
  });

  it("replays every Root negative vector with its contract error code", () => {
    for (const attack of corpus.negativeCases) {
      const base = corpus.positiveCases.find(({ id }) => id === attack.baseCaseId);
      if (base === undefined) throw new Error(`Root negative base missing: ${attack.id}`);
      const candidate = applyRootMutation(base, attack);
      expectCode(() => {
        const decoder = createCorpusDecoder(candidate);
        for (const frame of candidate.frames) admit(decoder, frame);
      }, attack.expectedCode);
    }
  });
});
