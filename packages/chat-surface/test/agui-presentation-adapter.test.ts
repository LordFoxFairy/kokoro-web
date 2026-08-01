import {
  AguiPresentationProtocolError,
  type AguiGrantBinding,
  type AguiPresentationSnapshotAuthority,
  type AguiSseFrame,
} from "@kokoro/session-client/agui-presentation-dormant";
import { describe, expect, it, vi } from "vitest";

import fixtureJson from "../../session-client/test/fixtures/root-agui-presentation-v1.json";

import {
  createDormantAguiProjectionAdapter,
  type ChatAguiPresentationMutation,
  type DormantAguiProjectionPort,
} from "../src/runtime/agui-presentation-adapter.js";

type FixtureFrame = Readonly<{
  id: string;
  event: string;
  data: Readonly<Record<string, unknown>>;
}>;

type FixtureCase = Readonly<{
  snapshot: Omit<AguiPresentationSnapshotAuthority, "runBindings" | "messageBindings">;
  grantBinding: AguiGrantBinding;
  frames: readonly FixtureFrame[];
}>;

type FixtureCorpus = Readonly<{ positiveCases: readonly FixtureCase[] }>;

const fixture: FixtureCorpus = fixtureJson as FixtureCorpus;
const contractCase = fixture.positiveCases[0];
if (contractCase === undefined) throw new Error("Root AG-UI fixture missing");

function snapshotAuthority(): AguiPresentationSnapshotAuthority {
  return {
    ...contractCase.snapshot,
    runBindings: [],
    messageBindings: [],
  };
}

function sse(frame: FixtureFrame): AguiSseFrame {
  return { id: frame.id, event: frame.event, data: JSON.stringify(frame.data) };
}

function rootFrame(sequence: number): AguiSseFrame {
  const frame = contractCase.frames[sequence - 1];
  if (frame === undefined) throw new Error(`Root AG-UI frame ${sequence} missing`);
  return sse(frame);
}

function createAdapter(
  dispatch: DormantAguiProjectionPort["dispatch"] = vi.fn(() => "applied" as const),
) {
  return {
    dispatch,
    adapter: createDormantAguiProjectionAdapter({
      grant: contractCase.grantBinding,
      snapshotAuthority: snapshotAuthority(),
      dispatch,
    }),
  };
}

function expectProtocolCode(operation: () => unknown, code: string): void {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AguiPresentationProtocolError);
    expect((error as AguiPresentationProtocolError).code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}

describe("AG-UI Chat projection adapter", () => {
  it("uses the public decoder to rebuild lifecycle and text authority from sequence zero", () => {
    const { adapter, dispatch } = createAdapter();
    adapter.accept(rootFrame(1));
    adapter.accept(rootFrame(2));

    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "agui.lifecycle",
      phase: "run-started",
      cursor: contractCase.frames[0]?.id,
      source: expect.objectContaining({ durableSeq: "1", projectionVersion: "1" }),
    }));
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "agui.text",
      phase: "start",
      source: expect.objectContaining({ durableSeq: "2", projectionVersion: "2" }),
    }));
    expect(adapter.getResumeRequest().cursorBinding.durableSeq).toBe("2");
  });

  it("preserves the closed activity discriminator/content correlation", () => {
    const dispatch = vi.fn((mutation: ChatAguiPresentationMutation) => {
      void mutation;
      return "applied" as const;
    });
    const { adapter } = createAdapter(dispatch);
    for (let sequence = 1; sequence <= 12; sequence += 1) adapter.accept(rootFrame(sequence));

    const mutation = dispatch.mock.calls.at(-1)?.[0];
    if (mutation?.type !== "agui.activity" || mutation.activityType !== "kokoro.notice.v1") {
      throw new Error("Root notice mutation missing");
    }
    expect(mutation.content).toMatchObject({ code: "PREVIEW_READY", severity: "info" });

    type NoticeMutation = Extract<
      ChatAguiPresentationMutation,
      { type: "agui.activity"; activityType: "kokoro.notice.v1" }
    >;
    const valid: NoticeMutation = mutation;
    // @ts-expect-error A notice discriminator cannot carry a media payload.
    const invalid: NoticeMutation = { ...mutation, content: { operationRef: "operation.01", state: "active", progressBps: 1 } };
    expect(valid.content.noticeRef).toBeDefined();
    expect(invalid.content).toBeDefined();
  });

  it("keeps replay and draining outside durable Chat mutation authority", () => {
    const { adapter, dispatch } = createAdapter();
    const first = rootFrame(1);
    adapter.accept(first);
    adapter.accept(first);
    const resume = adapter.getResumeRequest();
    adapter.accept({
      id: null,
      event: "kokoro.stream.draining",
      data: JSON.stringify({
        type: "stream.draining",
        profileRevision: contractCase.grantBinding.presentationProfileRevision,
        sessionId: contractCase.grantBinding.sessionId,
        streamEpoch: resume.cursorBinding.streamEpoch,
        lastDurableCursor: resume.queryCursor,
        action: "retry-same-cursor",
      }),
    });

    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({
      type: "agui.control",
      durable: false,
      action: "retry-same-cursor",
    }));
  });

  it("retries the identical staged mutation after an uncertain acknowledgement", () => {
    let appliedCursor: string | undefined;
    const dispatch = vi.fn((mutation: ChatAguiPresentationMutation) => {
      if (!mutation.durable) return "applied" as const;
      if (appliedCursor === mutation.cursor) return "replayed" as const;
      appliedCursor = mutation.cursor;
      throw new Error("consumer applied the mutation but lost its acknowledgement");
    });
    const { adapter } = createAdapter(dispatch);
    const first = rootFrame(1);

    expect(() => adapter.accept(first)).toThrow("lost its acknowledgement");
    expect(adapter.getResumeRequest().cursorBinding.durableSeq).toBe("0");
    adapter.accept(first);
    expect(dispatch.mock.calls[0]?.[0]).toEqual(dispatch.mock.calls[1]?.[0]);
    expect(adapter.getResumeRequest().cursorBinding.durableSeq).toBe("1");
  });

  it("rejects a different frame while one staged mutation awaits acknowledgement", () => {
    const dispatch = vi.fn(() => {
      throw new Error("ack unavailable");
    });
    const { adapter } = createAdapter(dispatch);
    const first = rootFrame(1);
    expect(() => adapter.accept(first)).toThrow("ack unavailable");
    const different = { ...first, data: `${String(first.data)} ` };
    expectProtocolCode(() => adapter.accept(different), "agui_admission_pending");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(adapter.getResumeRequest().cursorBinding.durableSeq).toBe("0");
  });

  it("rejects structured decoded-frame forgeries before dispatch", () => {
    const { adapter, dispatch } = createAdapter();
    const forged = {
      kind: "control",
      id: null,
      event: "kokoro.stream.draining",
      data: {
        type: "stream.draining",
        profileRevision: contractCase.grantBinding.presentationProfileRevision,
        sessionId: contractCase.grantBinding.sessionId,
      },
    };
    expect(() => Reflect.apply(adapter.accept, adapter, [forged])).toThrow(AguiPresentationProtocolError);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
