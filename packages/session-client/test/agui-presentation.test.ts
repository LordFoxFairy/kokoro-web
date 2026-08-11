import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as AguiPresentationModule from "../src/agui-presentation.js";
import {
  AguiPresentationProtocolError,
  admitAguiPresentationWireFrame,
  createAguiPresentationDecoder,
  type AguiGrantBinding,
  type AguiSseFrame,
} from "../src/agui-presentation.js";

type FixtureFrame = Readonly<{
  id: string;
  event: string;
  data: Readonly<Record<string, unknown>>;
}>;

type FixtureCase = Readonly<{
  snapshot: Readonly<Record<string, unknown>>;
  grantBinding: AguiGrantBinding;
  frames: readonly FixtureFrame[];
}>;

type FixtureCorpus = Readonly<{ positiveCases: readonly FixtureCase[] }>;

type CanonicalFrame = Readonly<{
  cursor: string;
  eventName: string;
  dataUtf8: string;
}>;

type CanonicalCorpus = Readonly<{
  wireFrames: Readonly<{
    scenarios: readonly Readonly<{
      stream: Readonly<{ frames: readonly CanonicalFrame[] }>;
    }>[];
  }>;
}>;

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/root-agui-presentation-v1.json", import.meta.url),
  "utf8",
)) as FixtureCorpus;
const canonicalFixture = JSON.parse(readFileSync(
  new URL("../src/generated/contracts/presentation/corpus-v1.json", import.meta.url),
  "utf8",
)) as CanonicalCorpus;

function primary(): FixtureCase {
  const contractCase = fixture.positiveCases[0];
  if (contractCase === undefined) throw new Error("Root AG-UI fixture missing");
  return contractCase;
}

function sse(frame: FixtureFrame): AguiSseFrame {
  return { id: frame.id, event: frame.event, data: JSON.stringify(frame.data) };
}

function decoder(contractCase = primary()) {
  return createAguiPresentationDecoder({
    grant: contractCase.grantBinding,
    snapshotAuthority: {
      ...contractCase.snapshot,
      runBindings: [],
      messageBindings: [],
      ownerBindings: [],
      ownerProjectionRows: [],
    },
  });
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

describe("AG-UI presentation decoder", () => {
  it("exports one stateless canonical wire admission with the Session snapshot decoder", () => {
    expect(AguiPresentationModule).toHaveProperty("createAguiPresentationDecoder");
    expect(AguiPresentationModule).toHaveProperty("admitAguiPresentationWireFrame");
    expect(AguiPresentationModule).not.toHaveProperty("createAguiPresentationStateMachineForTesting");
    expect(AguiPresentationModule.aguiBindingAuthorityContractMetadata).toEqual({
      owner: "kokoro-web",
      activeLane: "session-browser-v3",
      contractRevision: "kokoro.web.session-browser-v3-binding-compat.v1",
      profileRevision: "kokoro-agui-presentation.v1",
    });
  });

  it("admits canonical durable and draining wire syntax without manufacturing cursor authority", () => {
    const contractCase = primary();
    const first = contractCase.frames[0];
    if (first === undefined) throw new Error("Root AG-UI frame missing");
    const admit = Reflect.get(AguiPresentationModule, "admitAguiPresentationWireFrame") as
      ((frame: AguiSseFrame) => Readonly<{ kind: string; data: unknown }>) | undefined;
    expect(admit).toBeTypeOf("function");
    expect(admit?.(sse(first))).toMatchObject({
      kind: "durable",
      id: first.id,
      event: first.event,
      data: first.data,
    });
    expect(admit?.({
      id: null,
      event: "kokoro.stream.draining",
      data: JSON.stringify({
        type: "stream.draining",
        profileRevision: contractCase.grantBinding.presentationProfileRevision,
        sessionId: contractCase.grantBinding.sessionId,
        streamEpoch: String(contractCase.snapshot.streamEpoch),
        lastDurableCursor: contractCase.snapshot.cursor,
        action: "retry-same-cursor",
      }),
    })).toMatchObject({ kind: "control" });
  });

  it("keeps the active Session compatibility envelope distinct from the inactive canonical lane", () => {
    const activeFrame = primary().frames[0];
    const canonicalFrame = canonicalFixture.wireFrames.scenarios[0]?.stream.frames[0];
    if (activeFrame === undefined || canonicalFrame === undefined) {
      throw new Error("AG-UI compatibility fixtures missing");
    }

    expect(admitAguiPresentationWireFrame(sse(activeFrame))).toMatchObject({
      kind: "durable",
      data: activeFrame.data,
    });
    expectCode(() => admitAguiPresentationWireFrame({
      id: canonicalFrame.cursor,
      event: canonicalFrame.eventName,
      data: canonicalFrame.dataUtf8,
    }), "agui_projection_payload_invalid");
  });

  it("serializes admission, acknowledgement, replay, and resume state", () => {
    const contractCase = primary();
    const first = contractCase.frames[0];
    const second = contractCase.frames[1];
    if (first === undefined || second === undefined) throw new Error("Root AG-UI frames missing");
    const stateMachine = decoder(contractCase);
    const firstSse = sse(first);
    const prepared = stateMachine.prepare(firstSse);

    expect(stateMachine.getSnapshotAuthority().durableSeq).toBe("0");

    expectCode(() => stateMachine.prepare(sse(second)), "agui_admission_pending");
    expectCode(() => Reflect.apply(prepared.commit, prepared, ["failed"]), "agui_dispatch_ack_invalid");
    expect(stateMachine.getResumeRequest().cursorBinding.durableSeq).toBe("0");
    expect(stateMachine.getSnapshotAuthority().durableSeq).toBe("0");
    expect(stateMachine.prepare(firstSse)).toBe(prepared);

    prepared.commit("applied");
    expect(stateMachine.getResumeRequest()).toMatchObject({
      queryCursor: first.id,
      cursorBinding: { durableSeq: "1" },
    });
    expect(stateMachine.getSnapshotAuthority()).toMatchObject({
      durableSeq: "1",
      cursor: first.id,
      runBindings: [expect.objectContaining({ state: "open" })],
    });

    const replay = stateMachine.prepare(firstSse);
    expect(replay.decoded.kind).toBe("replay");
    replay.commit("replayed");
    expect(stateMachine.getResumeRequest().cursorBinding.durableSeq).toBe("1");

    stateMachine.prepare(sse(second)).commit("applied");
    expect(stateMachine.getResumeRequest().cursorBinding.durableSeq).toBe("2");
  });

  it("admits a non-durable draining control without changing resume state", () => {
    const contractCase = primary();
    const first = contractCase.frames[0];
    if (first === undefined) throw new Error("Root AG-UI frame missing");
    const stateMachine = decoder(contractCase);
    stateMachine.prepare(sse(first)).commit("applied");
    const before = stateMachine.getResumeRequest();
    const control = stateMachine.prepare({
      id: null,
      event: "kokoro.stream.draining",
      data: JSON.stringify({
        type: "stream.draining",
        profileRevision: contractCase.grantBinding.presentationProfileRevision,
        sessionId: contractCase.grantBinding.sessionId,
        streamEpoch: before.cursorBinding.streamEpoch,
        lastDurableCursor: before.queryCursor,
        action: "retry-same-cursor",
      }),
    });
    expect(control.decoded.kind).toBe("control");
    control.commit("applied");
    expect(stateMachine.getResumeRequest()).toEqual(before);
  });

  it("normalizes malformed JSON and oversized frames to closed protocol failures", () => {
    const stateMachine = decoder();
    expectCode(
      () => stateMachine.prepare({ id: "opaque.invalid.cursor", event: "RUN_STARTED", data: "{" }),
      "agui_frame_json_invalid",
    );
    expectCode(
      () => stateMachine.prepare({
        id: "opaque.oversized.cursor",
        event: "RUN_STARTED",
        data: `{"payload":"${"x".repeat(131_072)}"}`,
      }),
      "agui_frame_limit_exceeded",
    );
    expect(stateMachine.getResumeRequest().cursorBinding.durableSeq).toBe("0");
  });
});
