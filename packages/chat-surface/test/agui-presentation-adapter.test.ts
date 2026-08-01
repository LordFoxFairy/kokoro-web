import {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_PROFILE_REVISION,
  SESSION_AGUI_CONTRACT_REVISION,
  createAguiPresentationDecoder,
  type AguiDecodedFrame,
  type AguiGrantBinding,
} from "@kokoro/session-client";
import { describe, expect, it, vi } from "vitest";

import {
  createDormantAguiProjectionAdapter,
  mapAguiPresentationFrame,
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

function decode(event: Record<string, unknown>, sourceKind: string, bindings: {
  run?: string;
  message?: string;
} = {}): AguiDecodedFrame {
  const recordedAt = "2026-08-01T12:00:01.000Z";
  const decoder = createAguiPresentationDecoder({
    grant,
    initialCursor: {
      cursor: "opaque.cursor.initial",
      sessionId: grant.sessionId,
      streamEpoch: "41",
      durableSeq: "0",
      profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
      cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
    },
  });
  return decoder.decode({
    id: "opaque.cursor.0001",
    event: String(event.type),
    data: JSON.stringify({
      profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
      source: {
        sourceEventId: "source.01",
        sourceKind,
        sessionId: grant.sessionId,
        streamEpoch: "41",
        durableSeq: "1",
        projectionVersion: 1,
        schemaRevision: 1,
        recordedAt,
      },
      ...(bindings.run === undefined ? {} : { presentationRunBindingRef: bindings.run }),
      ...(bindings.message === undefined ? {} : { presentationMessageBindingRef: bindings.message }),
      event: { ...event, timestamp: Date.parse(recordedAt) },
    }),
  });
}

describe("dormant AG-UI Chat projection adapter", () => {
  it("maps lifecycle and text events without manufacturing SessionEvent authority", () => {
    const decoder = createAguiPresentationDecoder({
      grant,
      initialCursor: {
        cursor: "opaque.cursor.initial",
        sessionId: grant.sessionId,
        streamEpoch: "41",
        durableSeq: "0",
        profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
      },
    });
    const sequence = (seq: number, sourceKind: string, event: Record<string, unknown>, bindings: { run?: string; message?: string } = {}) => decoder.decode({
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
          recordedAt: `2026-08-01T12:00:${String(seq).padStart(2, "0")}.000Z`,
        },
        ...(bindings.run === undefined ? {} : { presentationRunBindingRef: bindings.run }),
        ...(bindings.message === undefined ? {} : { presentationMessageBindingRef: bindings.message }),
        event: { ...event, timestamp: Date.parse(`2026-08-01T12:00:${String(seq).padStart(2, "0")}.000Z`) },
      }),
    });
    const run = mapAguiPresentationFrame(sequence(1, "presentation.run.started", {
      type: EventType.RUN_STARTED,
      threadId: "thread.session.01",
      runId: "presentation.run.01",
    }, { run: "run-binding.01" }));
    expect(run).toMatchObject({
      type: "agui.lifecycle",
      phase: "run-started",
      runBindingRef: "run-binding.01",
      runId: "presentation.run.01",
      cursor: "opaque.cursor.0001",
      source: { sessionId: "session.01", durableSeq: "1" },
    });

    const start = mapAguiPresentationFrame(sequence(2, "presentation.message.text.started", {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "presentation.message.01",
      role: "assistant",
    }, { run: "run-binding.01", message: "message-binding.01" }));
    expect(start).toMatchObject({
      type: "agui.text",
      phase: "start",
      presentationMessageId: "presentation.message.01",
      runBindingRef: "run-binding.01",
      messageBindingRef: "message-binding.01",
    });
  });

  it("maps only closed activity and registered CUSTOM payloads", () => {
    const activityDecoder = createAguiPresentationDecoder({
      grant,
      initialCursor: {
        cursor: "opaque.cursor.initial",
        sessionId: grant.sessionId,
        streamEpoch: "41",
        durableSeq: "0",
        profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
      },
    });
    const frame = (seq: number, sourceKind: string, event: Record<string, unknown>) => activityDecoder.decode({
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
          recordedAt: `2026-08-01T12:00:${String(seq).padStart(2, "0")}.000Z`,
        },
        presentationRunBindingRef: "run-binding.01",
        ...(seq === 1 ? {} : { presentationMessageBindingRef: "message-binding.01" }),
        event: { ...event, timestamp: Date.parse(`2026-08-01T12:00:${String(seq).padStart(2, "0")}.000Z`) },
      }),
    });
    frame(1, "presentation.run.started", { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" });
    frame(2, "presentation.message.text.started", { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" });
    const activity = mapAguiPresentationFrame(frame(3, "presentation.activity.notice", {
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId: "message.01",
      activityType: "kokoro.notice.v1",
      content: { noticeRef: "notice.01", code: "SAFE_NOTICE", message: "Safe.", severity: "info" },
      replace: true,
    }));
    expect(activity).toMatchObject({
      type: "agui.activity",
      activityType: "kokoro.notice.v1",
      content: { code: "SAFE_NOTICE", message: "Safe." },
    });

    const custom = mapAguiPresentationFrame(decode({
      type: EventType.CUSTOM,
      name: "kokoro.session.replace.v1",
      value: {
        sessionId: "session.01",
        profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        title: "Thread",
        lifecycle: "active",
        contextPolicy: "standard",
        activeBranchId: "branch.01",
        version: 1,
      },
    }, "presentation.custom.session"));
    expect(custom).toMatchObject({
      type: "agui.custom",
      name: "kokoro.session.replace.v1",
      value: { sessionId: "session.01", contextPolicy: "standard" },
    });
  });

  it("keeps replay and draining outside durable Chat mutation authority", () => {
    const dispatch = vi.fn();
    const adapter = createDormantAguiProjectionAdapter({ dispatch });
    const control: AguiDecodedFrame = {
      kind: "control",
      id: null,
      event: "kokoro.stream.draining",
      data: {
        type: "stream.draining",
        profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        sessionId: "session.01",
        streamEpoch: "41",
        lastDurableCursor: "opaque.cursor.0001",
        action: "retry-same-cursor",
      },
    };
    adapter.accept(control);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "agui.control",
      durable: false,
      action: "retry-same-cursor",
    }));

    const durable = decode({ type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" }, "presentation.run.started", { run: "run.01" });
    if (durable.kind !== "durable") throw new Error("fixture must be durable");
    adapter.accept({ kind: "replay", frame: durable });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
