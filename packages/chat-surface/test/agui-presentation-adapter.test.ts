import {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_PROFILE_REVISION,
  SESSION_AGUI_CONTRACT_REVISION,
  AguiPresentationProtocolError,
  type AguiGrantBinding,
  type AguiSseFrame,
} from "@kokoro/session-client/agui-presentation-dormant";
import { describe, expect, it, vi } from "vitest";

import {
  createDormantAguiProjectionAdapter,
  type ChatAguiPresentationMutation,
  type DormantAguiProjectionPort,
} from "../src/runtime/agui-presentation-adapter.js";

const EventType = {
  RUN_STARTED: "RUN_STARTED",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  ACTIVITY_SNAPSHOT: "ACTIVITY_SNAPSHOT",
  CUSTOM: "CUSTOM",
} as const;

const grant = {
  sessionId: "session.01",
  sessionContractRevision: SESSION_AGUI_CONTRACT_REVISION,
  presentationProfileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
  cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
} as const satisfies AguiGrantBinding;

const initialCursor = {
  cursor: "opaque.cursor.initial",
  sessionId: grant.sessionId,
  streamEpoch: "41",
  durableSeq: "0",
  profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
  cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
} as const;

const snapshotAuthority = {
  authority: "session-browser-v3-http-snapshot",
  hydrate: true,
  repair: true,
  profileRevision: initialCursor.profileRevision,
  sessionId: initialCursor.sessionId,
  streamEpoch: initialCursor.streamEpoch,
  durableSeq: initialCursor.durableSeq,
  cursor: initialCursor.cursor,
  runBindings: [],
  messageBindings: [],
} as const;

function frame(
  seq: number,
  sourceKind: string,
  event: Readonly<Record<string, unknown>>,
  bindings: Readonly<{ run?: string; message?: string }> = {},
): AguiSseFrame {
  const recordedAt = `2026-08-01T12:00:${String(seq).padStart(2, "0")}.000Z`;
  return {
    id: `opaque.cursor.${String(seq).padStart(4, "0")}`,
    event: String(event.type),
    data: JSON.stringify({
      profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
      source: {
        sourceEventId: `source.${String(seq).padStart(2, "0")}`,
        sourceKind,
        sessionId: grant.sessionId,
        streamEpoch: "41",
        durableSeq: String(seq),
        projectionVersion: seq,
        schemaRevision: 1,
        recordedAt,
      },
      ...(bindings.run === undefined ? {} : { presentationRunBindingRef: bindings.run }),
      ...(bindings.message === undefined ? {} : { presentationMessageBindingRef: bindings.message }),
      event: { ...event, timestamp: Date.parse(recordedAt) },
    }),
  };
}

function createAdapter(
  dispatch: DormantAguiProjectionPort["dispatch"] = vi.fn(() => "applied" as const),
) {
  return {
    dispatch,
    adapter: createDormantAguiProjectionAdapter({ grant, snapshotAuthority, dispatch }),
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

describe("dormant AG-UI Chat projection adapter", () => {
  it("owns raw admission and maps lifecycle/text without manufacturing SessionEvent authority", () => {
    const { adapter, dispatch } = createAdapter();
    adapter.accept(frame(1, "presentation.run.started", {
      type: EventType.RUN_STARTED,
      threadId: "thread.session.01",
      runId: "presentation.run.01",
    }, { run: "run-binding.01" }));
    adapter.accept(frame(2, "presentation.message.text.started", {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "presentation.message.01",
      role: "assistant",
    }, { run: "run-binding.01", message: "message-binding.01" }));

    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: "agui.lifecycle",
      phase: "run-started",
      runBindingRef: "run-binding.01",
      runId: "presentation.run.01",
      cursor: "opaque.cursor.0001",
      source: expect.objectContaining({ sessionId: "session.01", durableSeq: "1" }),
    }));
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: "agui.text",
      phase: "start",
      presentationMessageId: "presentation.message.01",
      messageBindingRef: "message-binding.01",
    }));
  });

  it("preserves discriminator/content correlation for activity and CUSTOM mutations", () => {
    const dispatch = vi.fn((mutation: ChatAguiPresentationMutation) => {
      void mutation;
      return "applied" as const;
    });
    const { adapter } = createAdapter(dispatch);
    adapter.accept(frame(1, "presentation.run.started", {
      type: EventType.RUN_STARTED,
      threadId: "thread.01",
      runId: "run.01",
    }, { run: "run-binding.01" }));
    adapter.accept(frame(2, "presentation.message.text.started", {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "message.01",
      role: "assistant",
    }, { run: "run-binding.01", message: "message-binding.01" }));
    adapter.accept(frame(3, "presentation.activity.notice", {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "message.01",
      activityType: "kokoro.notice.v1",
      content: { noticeRef: "notice.01", code: "SAFE_NOTICE", message: "Safe.", severity: "info" },
      replace: true,
    }, { run: "run-binding.01", message: "message-binding.01" }));

    const activity = dispatch.mock.calls[2]?.[0] as ChatAguiPresentationMutation;
    if (activity.type !== "agui.activity" || activity.activityType !== "kokoro.notice.v1") {
      throw new Error("fixture mismatch");
    }
    expect(activity.content.code).toBe("SAFE_NOTICE");

    type NoticeMutation = Extract<
      ChatAguiPresentationMutation,
      { type: "agui.activity"; activityType: "kokoro.notice.v1" }
    >;
    const authority = {
      durable: true,
      cursor: "opaque.cursor.0003",
      source: activity.source,
      runBindingRef: "run-binding.01",
      messageBindingRef: "message-binding.01",
      type: "agui.activity",
      presentationMessageId: "message.01",
      activityType: "kokoro.notice.v1",
      replace: true,
    } as const;
    const valid: NoticeMutation = { ...authority, content: activity.content };
    // @ts-expect-error A notice discriminator must not accept a media payload.
    const invalid: NoticeMutation = { ...authority, content: { operationRef: "operation.01", state: "active", progressBps: 1 } };
    expect(valid.content.noticeRef).toBe("notice.01");
    expect(invalid.content).toBeDefined();
  });

  it("keeps replay and draining outside durable Chat mutation authority", () => {
    const { adapter, dispatch } = createAdapter();
    const durable = frame(1, "presentation.run.started", {
      type: EventType.RUN_STARTED,
      threadId: "thread.01",
      runId: "run.01",
    }, { run: "run.01" });
    adapter.accept(durable);
    adapter.accept(durable);
    adapter.accept({
      id: null,
      event: "kokoro.stream.draining",
      data: JSON.stringify({
        type: "stream.draining",
        profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        sessionId: "session.01",
        streamEpoch: "41",
        lastDurableCursor: "opaque.cursor.0001",
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

  it("does not advance resume authority until an idempotent dispatch acknowledges the mutation", () => {
    let appliedCursor: string | undefined;
    const dispatch = vi.fn((mutation: ChatAguiPresentationMutation) => {
      if (!mutation.durable) return "applied" as const;
      if (appliedCursor === mutation.cursor) return "replayed" as const;
      appliedCursor = mutation.cursor;
      throw new Error("consumer applied the mutation but lost its acknowledgement");
    });
    const { adapter } = createAdapter(dispatch);
    const durable = frame(1, "presentation.run.started", {
      type: EventType.RUN_STARTED,
      threadId: "thread.01",
      runId: "run.01",
    }, { run: "run.01" });

    expect(() => adapter.accept(durable)).toThrow("lost its acknowledgement");
    expect(adapter.getResumeRequest().cursorBinding.durableSeq).toBe("0");

    adapter.accept(durable);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0]?.[0]).toEqual(dispatch.mock.calls[1]?.[0]);
    expect(adapter.getResumeRequest().cursorBinding.durableSeq).toBe("1");
  });

  it("fails closed on a different frame while one admitted mutation awaits acknowledgement", () => {
    const dispatch = vi.fn(() => {
      throw new Error("ack unavailable");
    });
    const { adapter } = createAdapter(dispatch);
    const first = frame(1, "presentation.run.started", {
      type: EventType.RUN_STARTED,
      threadId: "thread.01",
      runId: "run.01",
    }, { run: "run.01" });
    expect(() => adapter.accept(first)).toThrow("ack unavailable");

    expectProtocolCode(
      () => adapter.accept(frame(1, "presentation.run.started", {
        type: EventType.RUN_STARTED,
        threadId: "thread.01",
        runId: "run.other",
      }, { run: "run.other" })),
      "agui_admission_pending",
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(adapter.getResumeRequest().cursorBinding.durableSeq).toBe("0");
  });

  it("requires an explicit applied or replayed dispatch acknowledgement", () => {
    const dispatch = vi.fn(() => undefined) as unknown as DormantAguiProjectionPort["dispatch"];
    const { adapter } = createAdapter(dispatch);
    expectProtocolCode(
      () => adapter.accept(frame(1, "presentation.run.started", {
        type: EventType.RUN_STARTED,
        threadId: "thread.01",
        runId: "run.01",
      }, { run: "run.01" })),
      "agui_dispatch_ack_invalid",
    );
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
        profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        sessionId: "session.01",
        streamEpoch: "41",
        lastDurableCursor: "opaque.cursor.initial",
        action: "retry-same-cursor",
      },
    } as unknown as AguiSseFrame;

    expect(() => adapter.accept(forged)).toThrow(AguiPresentationProtocolError);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
