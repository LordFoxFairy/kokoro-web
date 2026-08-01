import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import * as AguiPresentationModule from "../src/agui-presentation.js";
import {
  AguiPresentationProtocolError,
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

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/root-agui-presentation-v1.json", import.meta.url),
  "utf8",
)) as FixtureCorpus;

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
  it("exports only the Session snapshot decoder, never a future-authority seam", () => {
    expect(AguiPresentationModule).toHaveProperty("createAguiPresentationDecoder");
    expect(AguiPresentationModule).not.toHaveProperty("createAguiPresentationStateMachineForTesting");
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
