import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import * as AguiPresentationModule from "../src/agui-presentation.js";

import {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_LIMITS,
  AGUI_PRESENTATION_PROFILE_REVISION,
  SESSION_AGUI_CONTRACT_REVISION,
  AguiPresentationProtocolError,
  createAguiPresentationDecoder as createProductionAguiPresentationDecoder,
  type AguiGrantBinding,
  type AguiPresentationDecoder,
  type AguiDecodedFrame,
  type AguiSseFrame,
} from "../src/agui-presentation.js";

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

type FrameOptions = Readonly<{
  seq: number;
  sourceKind: string;
  event: Readonly<Record<string, unknown>>;
  runBindingRef?: string;
  messageBindingRef?: string;
  sessionId?: string;
  streamEpoch?: string;
  cursor?: string;
}>;

function durableFrame(options: FrameOptions): AguiSseFrame {
  const recordedAt = `2026-08-01T12:00:${String(options.seq).padStart(2, "0")}.000Z`;
  const event: Record<string, unknown> = { ...options.event, timestamp: Date.parse(recordedAt) };
  return {
    id: options.cursor ?? `opaque.cursor.${String(options.seq).padStart(4, "0")}`,
    event: String(event.type),
    data: JSON.stringify({
      profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
      source: {
        sourceEventId: `source.${String(options.seq).padStart(2, "0")}`,
        sourceKind: options.sourceKind,
        sessionId: options.sessionId ?? grant.sessionId,
        streamEpoch: options.streamEpoch ?? "41",
        durableSeq: String(options.seq),
        projectionVersion: options.seq,
        schemaRevision: 1,
        recordedAt,
      },
      ...(options.runBindingRef === undefined ? {} : { presentationRunBindingRef: options.runBindingRef }),
      ...(options.messageBindingRef === undefined ? {} : { presentationMessageBindingRef: options.messageBindingRef }),
      event,
    }),
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

function admitAfterExternalAck(
  decoder: AguiPresentationDecoder,
  frame: AguiSseFrame,
): AguiDecodedFrame {
  const prepared = decoder.prepare(frame);
  prepared.commit("applied");
  return prepared.decoded;
}

function createAguiPresentationDecoder(options: Readonly<{
  grant: AguiGrantBinding;
  initialCursor: typeof initialCursor | Readonly<{
    cursor: string;
    sessionId: string;
    streamEpoch: string;
    durableSeq: string;
    profileRevision: typeof AGUI_PRESENTATION_PROFILE_REVISION;
    cursorProfileRevision: typeof AGUI_CURSOR_PROFILE_REVISION;
  }>;
  limits?: Readonly<{ streamIdentities?: number; runs?: number; messages?: number }>;
}>): AguiPresentationDecoder {
  return createProductionAguiPresentationDecoder({
    grant: options.grant,
    snapshotAuthority: {
      authority: "session-browser-v3-http-snapshot",
      hydrate: true,
      repair: true,
      profileRevision: options.initialCursor.profileRevision,
      sessionId: options.initialCursor.sessionId,
      streamEpoch: options.initialCursor.streamEpoch,
      durableSeq: options.initialCursor.durableSeq,
      cursor: options.initialCursor.cursor,
      runBindings: [],
      messageBindings: [],
    },
    ...(options.limits === undefined ? {} : { limits: options.limits }),
  });
}

describe("strict Session-owned AG-UI decoder", () => {
  it("resumes from a trusted nonzero HTTP snapshot watermark", () => {
    const decoder = createAguiPresentationDecoder({
      grant,
      initialCursor: { ...initialCursor, durableSeq: "9" },
    });
    expect(decoder.getResumeRequest()).toMatchObject({ cursorBinding: { durableSeq: "9" } });
  });

  it("preserves the Root profile, SSE identity, and Last-Event-ID binding", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const decoded = admitAfterExternalAck(decoder, durableFrame({
      seq: 1,
      sourceKind: "presentation.run.started",
      runBindingRef: "run-binding.01.segment.0",
      event: {
        type: EventType.RUN_STARTED,
        threadId: "thread.session.01",
        runId: "presentation.run.01.segment.0",
      },
    }));

    expect(decoded).toMatchObject({
      kind: "durable",
      id: "opaque.cursor.0001",
      event: EventType.RUN_STARTED,
      cursorBinding: {
        sessionId: "session.01",
        streamEpoch: "41",
        durableSeq: "1",
      },
    });
    expect(decoder.getResumeRequest()).toEqual({
      headers: { "last-event-id": "opaque.cursor.0001" },
      queryCursor: "opaque.cursor.0001",
      cursorBinding: expect.objectContaining({ durableSeq: "1" }),
    });
  });

  it("keeps prepared authority pending until an explicit idempotent commit", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const first = durableFrame({
      seq: 1,
      sourceKind: "presentation.run.started",
      runBindingRef: "run.01",
      event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" },
    });
    const prepared = decoder.prepare(first);
    expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe("0");
    expect(decoder.prepare(first)).toBe(prepared);
    expectCode(
      () => decoder.prepare(durableFrame({
        seq: 1,
        sourceKind: "presentation.run.started",
        runBindingRef: "run.other",
        event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.other" },
      })),
      "agui_admission_pending",
    );

    prepared.commit("applied");
    prepared.commit("replayed");
    expect(decoder.getResumeRequest().cursorBinding.durableSeq).toBe("1");
  });

  it("accepts the Root lifecycle, text, activity, and registered CUSTOM vocabulary", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const frames: AguiSseFrame[] = [
      durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run-binding.01.segment.0", event: { type: EventType.RUN_STARTED, threadId: "thread.session.01", runId: "presentation.run.01.segment.0" } }),
      durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.TEXT_MESSAGE_START, messageId: "presentation.message.01.segment.0", role: "assistant" } }),
      durableFrame({ seq: 3, sourceKind: "presentation.message.text.content", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "presentation.message.01.segment.0", delta: "Safe text." } }),
      durableFrame({ seq: 4, sourceKind: "presentation.activity.safe-summary", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.safe-summary.v1", content: { partRef: "part.summary.01", summary: "Safe summary.", status: "complete" }, replace: true } }),
      durableFrame({ seq: 5, sourceKind: "presentation.activity.tool-preview", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.tool-preview.v1", content: { toolCallRef: "tool.01", label: "Search", status: "completed", resultPreview: "Safe preview.", truncated: true }, replace: true } }),
      durableFrame({ seq: 6, sourceKind: "presentation.activity.hitl", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.hitl.v1", content: { ownerRef: "owner.01", expectedVersion: 1, kind: "approval", title: "Approve", description: "Approve safe effect.", allowedActions: ["accept", "reject"], status: "pending" }, replace: true } }),
      durableFrame({ seq: 7, sourceKind: "presentation.activity.plan", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.plan.v1", content: { planRef: "plan.01", summary: "Safe plan.", status: "active", steps: [{ stepRef: "step.01", label: "Check", status: "in-progress" }] }, replace: true } }),
      durableFrame({ seq: 8, sourceKind: "presentation.activity.subagent", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.subagent.v1", content: { subagentRef: "subagent.01", status: "running", summary: "Reviewing." }, replace: true } }),
      durableFrame({ seq: 9, sourceKind: "presentation.activity.media", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.media.v1", content: { operationRef: "operation.01", state: "active", progressBps: 5000, summary: "Generating." }, replace: true } }),
      durableFrame({ seq: 10, sourceKind: "presentation.activity.artifact", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.artifact.v1", content: { artifactRef: "artifact.01", artifactVersionRef: "artifact-version.01", availability: "ready", mediaClass: "image", title: "Result" }, replace: true } }),
      durableFrame({ seq: 11, sourceKind: "presentation.activity.cost", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.cost.v1", content: { costProjectionRef: "cost.01", state: "final", displayAmount: "12.5", unit: "credits", freshness: "2026-08-01T12:00:11.000Z" }, replace: true } }),
      durableFrame({ seq: 12, sourceKind: "presentation.activity.notice", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.notice.v1", content: { noticeRef: "notice.01", code: "SAFE_NOTICE", message: "Safe notice.", severity: "info" }, replace: true } }),
      durableFrame({ seq: 13, sourceKind: "presentation.activity.error", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.error.v1", content: { errorRef: "error.01", code: "SAFE_ERROR", message: "Safe error.", retryClass: "never" }, replace: true } }),
      durableFrame({ seq: 14, sourceKind: "presentation.custom.session", event: { type: EventType.CUSTOM, name: "kokoro.session.replace.v1", value: { sessionId: "session.01", profileRevision: AGUI_PRESENTATION_PROFILE_REVISION, title: "Thread", lifecycle: "active", contextPolicy: "standard", activeBranchId: "branch.01", version: 1 } } }),
      durableFrame({ seq: 15, sourceKind: "presentation.custom.branch", event: { type: EventType.CUSTOM, name: "kokoro.branch.replace.v1", value: { branchId: "branch.01", rootMessageId: "message.user.01", leafMessageId: "message.assistant.01", version: 1 } } }),
      durableFrame({ seq: 16, sourceKind: "presentation.custom.message", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "presentation.message.01.segment.0", role: "assistant", lifecycle: "streaming", parentPresentationMessageId: null, ordinal: 1, version: 1 } } }),
      durableFrame({ seq: 17, sourceKind: "presentation.custom.run", runBindingRef: "run-binding.01.segment.0", event: { type: EventType.CUSTOM, name: "kokoro.run.replace.v1", value: { presentationRunId: "presentation.run.01.segment.0", state: "waiting", projectionVersion: 1 } } }),
      durableFrame({ seq: 18, sourceKind: "presentation.custom.control", runBindingRef: "run-binding.01.segment.0", event: { type: EventType.CUSTOM, name: "kokoro.control.replace.v1", value: { controlRef: "control.01", kind: "approval", state: "pending", expectedVersion: 1, allowedActions: ["accept", "reject"] } } }),
      durableFrame({ seq: 19, sourceKind: "presentation.custom.receipt", runBindingRef: "run-binding.01.segment.0", event: { type: EventType.CUSTOM, name: "kokoro.receipt.replace.v1", value: { receiptRef: "receipt.01", commandId: "command.01", operation: "approve", state: "committed", version: 1 } } }),
      durableFrame({ seq: 20, sourceKind: "presentation.message.text.ended", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.TEXT_MESSAGE_END, messageId: "presentation.message.01.segment.0" } }),
      durableFrame({ seq: 21, sourceKind: "presentation.run.finished", runBindingRef: "run-binding.01.segment.0", event: { type: EventType.RUN_FINISHED, threadId: "thread.session.01", runId: "presentation.run.01.segment.0" } }),
      durableFrame({ seq: 22, sourceKind: "presentation.run.started", runBindingRef: "run-binding.01.segment.1", event: { type: EventType.RUN_STARTED, threadId: "thread.session.01", runId: "presentation.run.01.segment.1" } }),
      durableFrame({ seq: 23, sourceKind: "presentation.message.text.started", runBindingRef: "run-binding.01.segment.1", messageBindingRef: "message-binding.01.segment.1", event: { type: EventType.TEXT_MESSAGE_START, messageId: "presentation.message.01.segment.1", role: "assistant" } }),
      durableFrame({ seq: 24, sourceKind: "presentation.message.text.content", runBindingRef: "run-binding.01.segment.1", messageBindingRef: "message-binding.01.segment.1", event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "presentation.message.01.segment.1", delta: "Resumed safely." } }),
      durableFrame({ seq: 25, sourceKind: "presentation.message.text.ended", runBindingRef: "run-binding.01.segment.1", messageBindingRef: "message-binding.01.segment.1", event: { type: EventType.TEXT_MESSAGE_END, messageId: "presentation.message.01.segment.1" } }),
      durableFrame({ seq: 26, sourceKind: "presentation.run.finished", runBindingRef: "run-binding.01.segment.1", event: { type: EventType.RUN_FINISHED, threadId: "thread.session.01", runId: "presentation.run.01.segment.1" } }),
    ];

    expect(frames.map((frame) => admitAfterExternalAck(decoder, frame).kind)).toEqual(Array.from({ length: 26 }, () => "durable"));
  });

  it("fails closed on every Root negative presentation vector", () => {
    const base = durableFrame({
      seq: 1,
      sourceKind: "presentation.run.started",
      runBindingRef: "run-binding.01.segment.0",
      event: { type: EventType.RUN_STARTED, threadId: "thread.session.01", runId: "presentation.run.01.segment.0" },
    });
    const parsed = JSON.parse(base.data) as Record<string, unknown>;
    const event = (parsed.event as Record<string, unknown>);

    for (const [name, mutate, expectedCode] of [
      ["event-extras-smuggling", (value: Record<string, unknown>) => { (value.event as Record<string, unknown>).extras = { provider: "hidden" }; }, "agui_event_extra_forbidden"],
      ["raw-event-smuggling", (value: Record<string, unknown>) => { (value.event as Record<string, unknown>).rawEvent = { providerPayload: "hidden" }; }, "agui_raw_event_forbidden"],
      ["chain-of-thought-field", (value: Record<string, unknown>) => { (value.event as Record<string, unknown>).chainOfThought = "private reasoning"; }, "agui_cot_forbidden"],
    ] as const) {
      const candidate = structuredClone(parsed);
      mutate(candidate);
      expectCode(() => admitAfterExternalAck(createAguiPresentationDecoder({ grant, initialCursor }), { ...base, data: JSON.stringify(candidate) }), expectedCode);
      expect(name).toBeTruthy();
    }

    const wrongType = { ...base, event: EventType.RUN_FINISHED };
    expectCode(() => admitAfterExternalAck(createAguiPresentationDecoder({ grant, initialCursor }), wrongType), "agui_sse_event_type_mismatch");

    const wrongCustom = durableFrame({ seq: 1, sourceKind: "presentation.custom.session", event: { type: EventType.CUSTOM, name: "vendor.unregistered", value: {} } });
    expectCode(() => admitAfterExternalAck(createAguiPresentationDecoder({ grant, initialCursor }), wrongCustom), "agui_unknown_custom");

    const wrongTool = durableFrame({ seq: 1, sourceKind: "presentation.activity.tool-preview", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.tool-preview.v1", content: { toolCallRef: "tool.01", label: "Search", status: "running", apiKey: "secret" }, replace: true } });
    expectCode(() => admitAfterExternalAck(createAguiPresentationDecoder({ grant, initialCursor }), wrongTool), "agui_tool_secret_forbidden");
    expect(event.type).toBe(EventType.RUN_STARTED);
  });

  it("rejects RAW, native tool, state, reasoning, thinking, and unknown event families", () => {
    for (const type of [
      EventType.RAW,
      EventType.TOOL_CALL_START,
      EventType.STATE_SNAPSHOT,
      EventType.REASONING_START,
      EventType.THINKING_START,
      "VENDOR_UNKNOWN",
    ]) {
      const frame = durableFrame({
        seq: 1,
        sourceKind: "presentation.run.started",
        event: { type },
      });
      expectCode(
        () => admitAfterExternalAck(createAguiPresentationDecoder({ grant, initialCursor }), frame),
        "agui_event_type_forbidden",
      );
    }
  });

  it("rejects cursor gaps, epoch or Session scope drift, and duplicate identities", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const first = durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "presentation.run.01" } });
    admitAfterExternalAck(decoder, first);

    const gap = durableFrame({ seq: 3, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "presentation.run.01" } });
    expectCode(() => admitAfterExternalAck(decoder, gap), "agui_cursor_gap");

    const crossSession = durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", sessionId: "session.other", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "presentation.run.01" } });
    expectCode(() => admitAfterExternalAck(decoder, crossSession), "agui_stream_scope_conflict");

    const wrongEpoch = durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", streamEpoch: "42", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "presentation.run.01" } });
    expectCode(() => admitAfterExternalAck(decoder, wrongEpoch), "agui_stream_scope_conflict");
  });

  it("keeps END and terminal facts irreversible while requiring a new resumed message id", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const frames = [
      durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.segment.0", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.segment.0" } }),
      durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.segment.0", messageBindingRef: "message.segment.0", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.segment.0", role: "assistant" } }),
      durableFrame({ seq: 3, sourceKind: "presentation.message.text.ended", runBindingRef: "run.segment.0", messageBindingRef: "message.segment.0", event: { type: EventType.TEXT_MESSAGE_END, messageId: "message.segment.0" } }),
      durableFrame({ seq: 4, sourceKind: "presentation.run.finished", runBindingRef: "run.segment.0", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.segment.0" } }),
      durableFrame({ seq: 5, sourceKind: "presentation.run.started", runBindingRef: "run.segment.1", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.segment.1" } }),
      durableFrame({ seq: 6, sourceKind: "presentation.message.text.started", runBindingRef: "run.segment.1", messageBindingRef: "message.segment.1", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.segment.1", role: "assistant" } }),
    ];
    for (const frame of frames) admitAfterExternalAck(decoder, frame);

    const reopenEnded = durableFrame({ seq: 7, sourceKind: "presentation.message.text.started", runBindingRef: "run.segment.1", messageBindingRef: "message.reused", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.segment.0", role: "assistant" } });
    expectCode(() => admitAfterExternalAck(decoder, reopenEnded), "agui_message_reopened");

    const reviveRun = durableFrame({ seq: 7, sourceKind: "presentation.run.started", runBindingRef: "run.segment.0", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.segment.0" } });
    expectCode(() => admitAfterExternalAck(decoder, reviveRun), "agui_terminal_run_revived");
  });

  it("locks presentation thread scope and validates visible parent run lineage", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(decoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "parent.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.parent.01" } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "parent.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.parent.01" } }));
    expect(admitAfterExternalAck(decoder, durableFrame({ seq: 3, sourceKind: "presentation.run.started", runBindingRef: "child.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.child.01", parentRunId: "run.parent.01" } }))).toMatchObject({ kind: "durable" });

    const missingParent = createAguiPresentationDecoder({ grant, initialCursor });
    expectCode(() => admitAfterExternalAck(missingParent, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "child.02", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.child.02", parentRunId: "run.other-session" } })), "agui_run_parent_lineage_conflict");

    const selfParent = createAguiPresentationDecoder({ grant, initialCursor });
    expectCode(() => admitAfterExternalAck(selfParent, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "child.03", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.child.03", parentRunId: "run.child.03" } })), "agui_run_parent_lineage_conflict");

    expectCode(() => admitAfterExternalAck(decoder, durableFrame({ seq: 4, sourceKind: "presentation.run.started", runBindingRef: "run.thread-drift", event: { type: EventType.RUN_STARTED, threadId: "thread.other", runId: "run.thread-drift" } })), "agui_run_thread_scope_conflict");
  });

  it("rejects terminal run evidence while one of its messages remains open", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(decoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    expectCode(() => admitAfterExternalAck(decoder, durableFrame({ seq: 3, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.01" } })), "agui_run_message_open");

    const errorDecoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(errorDecoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.error", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.error" } }));
    admitAfterExternalAck(errorDecoder, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.error", messageBindingRef: "message.error", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.error", role: "assistant" } }));
    expectCode(() => admitAfterExternalAck(errorDecoder, durableFrame({ seq: 3, sourceKind: "presentation.run.error", runBindingRef: "run.error", event: { type: EventType.RUN_ERROR, message: "Safe failure.", code: "RUN_FAILED" } })), "agui_run_message_open");
  });

  it("fails closed instead of evicting durable identity and terminal authority", () => {
    const decoder = createAguiPresentationDecoder({
      grant,
      initialCursor,
      limits: { streamIdentities: 2 },
    });
    admitAfterExternalAck(decoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    expectCode(() => admitAfterExternalAck(decoder, durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.01" } })), "agui_authority_capacity_exceeded");
    expect(decoder.getResumeRequest()).toMatchObject({ cursorBinding: { durableSeq: "1" } });
  });

  it("uses separate production-bounded ledgers for stream, run, and message authority", () => {
    for (const limits of [
      { streamIdentities: 4_097 },
      { runs: 257 },
      { messages: 513 },
    ]) {
      expectCode(
        () => createAguiPresentationDecoder({ grant, initialCursor, limits }),
        "agui_authority_limit_invalid",
      );
    }

    const runDecoder = createAguiPresentationDecoder({ grant, initialCursor, limits: { runs: 1 } });
    admitAfterExternalAck(runDecoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(runDecoder, durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.01" } }));
    expectCode(
      () => admitAfterExternalAck(runDecoder, durableFrame({ seq: 3, sourceKind: "presentation.run.started", runBindingRef: "run.02", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.02" } })),
      "agui_authority_capacity_exceeded",
    );

    const messageDecoder = createAguiPresentationDecoder({ grant, initialCursor, limits: { messages: 1 } });
    admitAfterExternalAck(messageDecoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(messageDecoder, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    admitAfterExternalAck(messageDecoder, durableFrame({ seq: 3, sourceKind: "presentation.message.text.ended", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_END, messageId: "message.01" } }));
    expectCode(
      () => admitAfterExternalAck(messageDecoder, durableFrame({ seq: 4, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.02", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.02", role: "assistant" } })),
      "agui_authority_capacity_exceeded",
    );
  });

  it("keeps stream.draining non-durable and bound to the last cursor", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(decoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    const before = decoder.getResumeRequest();
    const draining = admitAfterExternalAck(decoder, {
      id: null,
      event: "kokoro.stream.draining",
      data: JSON.stringify({
        type: "stream.draining",
        profileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        sessionId: grant.sessionId,
        streamEpoch: "41",
        lastDurableCursor: "opaque.cursor.0001",
        action: "retry-same-cursor",
        retryAfterMs: 250,
      }),
    });

    expect(draining).toMatchObject({ kind: "control", data: { action: "retry-same-cursor" } });
    expect(decoder.getResumeRequest()).toEqual(before);
  });

  it("deep-freezes validated payloads so callers cannot inject fields after admission", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(decoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    const decoded = admitAfterExternalAck(decoder, durableFrame({ seq: 3, sourceKind: "presentation.activity.tool-preview", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "message.01", activityType: "kokoro.tool-preview.v1", content: { toolCallRef: "tool.01", label: "Search", status: "running" }, replace: true } }));
    if (decoded.kind !== "durable" || decoded.data.event.type !== EventType.ACTIVITY_SNAPSHOT) throw new Error("fixture mismatch");
    const unsafe = decoded.data.event.content as { apiKey?: string };
    expect(() => { unsafe.apiKey = "injected-secret"; }).toThrow(TypeError);
    expect(unsafe).not.toHaveProperty("apiKey");
  });

  it("enforces frame, event, depth, node, key, array, id, and cursor budgets before official parsing", () => {
    const oversized = "x".repeat(131_072);
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    expectCode(() => admitAfterExternalAck(decoder, { id: "opaque.cursor.0001", event: EventType.RUN_ERROR, data: oversized }), "agui_frame_limit_exceeded");

    const deeplyNested = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", event: { type: EventType.RUN_ERROR, message: "Safe", code: "RUN_FAILED" } });
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 14; depth += 1) nested = { nested };
    const parsed = JSON.parse(deeplyNested.data) as Record<string, unknown>;
    parsed.extra = nested;
    expectCode(() => admitAfterExternalAck(decoder, { ...deeplyNested, data: JSON.stringify(parsed) }), "agui_frame_limit_exceeded");

    const hostileDepth = 10_000;
    const hostileJson = `${'{"nested":'.repeat(hostileDepth)}null${"}".repeat(hostileDepth)}`;
    expectCode(
      () => admitAfterExternalAck(decoder, { id: "opaque.cursor.0001", event: EventType.RUN_ERROR, data: hostileJson }),
      "agui_frame_limit_exceeded",
    );

    const tooManyNodes = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", event: { type: EventType.RUN_ERROR, message: "Safe", code: "RUN_FAILED" } });
    const nodePayload = JSON.parse(tooManyNodes.data) as Record<string, unknown>;
    nodePayload.extra = Array.from({ length: 256 }, () => Array.from({ length: 16 }, () => 1));
    expectCode(() => admitAfterExternalAck(decoder, { ...tooManyNodes, data: JSON.stringify(nodePayload) }), "agui_frame_limit_exceeded");

    const eventLimitDecoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(eventLimitDecoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(eventLimitDecoder, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    const hugePlan = durableFrame({
      seq: 3,
      sourceKind: "presentation.activity.plan",
      runBindingRef: "run.01",
      messageBindingRef: "message.01",
      event: {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: "message.01",
        activityType: "kokoro.plan.v1",
        content: {
          planRef: "plan.01",
          summary: "Safe plan.",
          status: "active",
          steps: Array.from({ length: 80 }, (_, index) => ({
            stepRef: `step.${index}`,
            label: "x".repeat(900),
            status: "pending",
          })),
        },
        replace: true,
      },
    });
    expectCode(() => admitAfterExternalAck(eventLimitDecoder, hugePlan), "agui_event_limit_exceeded");

    const tooManyKeys = JSON.parse(tooManyNodes.data) as Record<string, unknown>;
    for (let index = 0; index < 65; index += 1) tooManyKeys[`extra${index}`] = index;
    expectCode(() => admitAfterExternalAck(decoder, { ...tooManyNodes, data: JSON.stringify(tooManyKeys) }), "agui_frame_limit_exceeded");

    const tooManyItems = JSON.parse(tooManyNodes.data) as Record<string, unknown>;
    tooManyItems.extra = Array.from({ length: 257 }, () => 1);
    expectCode(() => admitAfterExternalAck(decoder, { ...tooManyNodes, data: JSON.stringify(tooManyItems) }), "agui_frame_limit_exceeded");

    const longId = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", event: { type: EventType.RUN_ERROR, message: "Safe", code: "R".repeat(129) } });
    expectCode(() => admitAfterExternalAck(decoder, longId), "agui_event_shape_invalid");

    const longCursor = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", cursor: `opaque.${"x".repeat(2_050)}`, event: { type: EventType.RUN_ERROR, message: "Safe", code: "RUN_FAILED" } });
    expectCode(() => admitAfterExternalAck(decoder, longCursor), "agui_cursor_invalid");
  });

  it("rejects hostile raw frame objects before serialization or payload copying", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const circular: Record<string, unknown> = {
      id: "opaque.cursor.0001",
      event: EventType.RUN_ERROR,
      data: "{}",
    };
    circular.self = circular;
    expectCode(
      () => admitAfterExternalAck(decoder, circular as unknown as AguiSseFrame),
      "agui_sse_frame_shape_invalid",
    );

    expectCode(
      () => admitAfterExternalAck(decoder, {
        id: "opaque.cursor.0001",
        event: EventType.RUN_ERROR,
        data: 1n,
      } as unknown as AguiSseFrame),
      "agui_sse_frame_shape_invalid",
    );

    class NonPlainFrame {
      readonly id = "opaque.cursor.0001";
      readonly event = EventType.RUN_ERROR;
      readonly data = "{}";
    }
    expectCode(
      () => admitAfterExternalAck(decoder, new NonPlainFrame() as unknown as AguiSseFrame),
      "agui_sse_frame_shape_invalid",
    );

    expectCode(
      () => admitAfterExternalAck(decoder, {
        id: "opaque.cursor.0001",
        event: EventType.RUN_ERROR,
        data: "x".repeat(AGUI_PRESENTATION_LIMITS.maximumFrameBytes + 1),
      }),
      "agui_frame_limit_exceeded",
    );
  });

  it("exposes only prepare-ack-commit admission on the production decoder", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    expect(decoder).not.toHaveProperty("decode");
  });

  it("publishes a compact replay-memory bound and fails closed for non-latest cursor retries", () => {
    const replayBounds = (AguiPresentationModule as unknown as Record<string, unknown>)["AGUI_PRESENTATION_REPLAY_MEMORY_BOUNDS"];
    expect(replayBounds).toEqual({
      retainedWireFrames: 2,
      maximumRetainedWireBytes: AGUI_PRESENTATION_LIMITS.maximumFrameBytes * 2,
      historicalCursorIdentityBytes: 4_096 * AGUI_PRESENTATION_LIMITS.maximumCursorBytes,
      historicalSourceIdentityBytes: 4_096 * AGUI_PRESENTATION_LIMITS.maximumIdBytes,
    });

    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const first = durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } });
    const second = durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.01" } });
    admitAfterExternalAck(decoder, first);
    admitAfterExternalAck(decoder, second);
    expect(admitAfterExternalAck(decoder, second)).toMatchObject({ kind: "replay", frame: { id: second.id } });
    expectCode(() => admitAfterExternalAck(decoder, first), "agui_stream_identity_duplicate");
  });

  it("locks CUSTOM run owner versions, identity, and irreversible lifecycle", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(decoder, durableFrame({
      seq: 1,
      sourceKind: "presentation.run.started",
      runBindingRef: "run-binding.01",
      event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" },
    }));
    const running = durableFrame({
      seq: 2,
      sourceKind: "presentation.custom.run",
      runBindingRef: "run-binding.01",
      event: {
        type: EventType.CUSTOM,
        name: "kokoro.run.replace.v1",
        value: { presentationRunId: "run.01", state: "running", projectionVersion: 1 },
      },
    });
    admitAfterExternalAck(decoder, running);
    admitAfterExternalAck(decoder, durableFrame({
      seq: 3,
      sourceKind: "presentation.custom.run",
      runBindingRef: "run-binding.01",
      event: {
        type: EventType.CUSTOM,
        name: "kokoro.run.replace.v1",
        value: { presentationRunId: "run.01", state: "running", projectionVersion: 1 },
      },
    }));
    expectCode(
      () => admitAfterExternalAck(decoder, durableFrame({
        seq: 4,
        sourceKind: "presentation.custom.run",
        runBindingRef: "run-binding.01",
        event: {
          type: EventType.CUSTOM,
          name: "kokoro.run.replace.v1",
          value: { presentationRunId: "run.01", state: "waiting", projectionVersion: 1 },
        },
      })),
      "agui_run_owner_same_version_conflict",
    );
    expectCode(
      () => admitAfterExternalAck(decoder, durableFrame({
        seq: 4,
        sourceKind: "presentation.custom.run",
        runBindingRef: "run-binding.01",
        event: {
          type: EventType.CUSTOM,
          name: "kokoro.run.replace.v1",
          value: { presentationRunId: "run.other", state: "running", projectionVersion: 2 },
        },
      })),
      "agui_run_owner_identity_conflict",
    );

    const progression = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(progression, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run-binding.02", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.02" } }));
    for (const [seq, state, version] of [[2, "running", 1], [3, "waiting", 2]] as const) {
      admitAfterExternalAck(progression, durableFrame({
        seq,
        sourceKind: "presentation.custom.run",
        runBindingRef: "run-binding.02",
        event: { type: EventType.CUSTOM, name: "kokoro.run.replace.v1", value: { presentationRunId: "run.02", state, projectionVersion: version } },
      }));
    }
    for (const [version, code] of [[1, "agui_run_owner_version_regression"], [4, "agui_run_owner_version_gap"]] as const) {
      expectCode(
        () => admitAfterExternalAck(progression, durableFrame({
          seq: 4,
          sourceKind: "presentation.custom.run",
          runBindingRef: "run-binding.02",
          event: { type: EventType.CUSTOM, name: "kokoro.run.replace.v1", value: { presentationRunId: "run.02", state: "finished", projectionVersion: version } },
        })),
        code,
      );
    }
    admitAfterExternalAck(progression, durableFrame({
      seq: 4,
      sourceKind: "presentation.custom.run",
      runBindingRef: "run-binding.02",
      event: { type: EventType.CUSTOM, name: "kokoro.run.replace.v1", value: { presentationRunId: "run.02", state: "finished", projectionVersion: 3 } },
    }));
    expectCode(
      () => admitAfterExternalAck(progression, durableFrame({
        seq: 5,
        sourceKind: "presentation.custom.run",
        runBindingRef: "run-binding.02",
        event: { type: EventType.CUSTOM, name: "kokoro.run.replace.v1", value: { presentationRunId: "run.02", state: "running", projectionVersion: 4 } },
      })),
      "agui_run_owner_transition_invalid",
    );
  });

  it("interlocks CUSTOM run terminal state with native RUN terminal evidence", () => {
    const mismatch = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(mismatch, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(mismatch, durableFrame({ seq: 2, sourceKind: "presentation.custom.run", runBindingRef: "run.01", event: { type: EventType.CUSTOM, name: "kokoro.run.replace.v1", value: { presentationRunId: "run.01", state: "finished", projectionVersion: 1 } } }));
    expectCode(
      () => admitAfterExternalAck(mismatch, durableFrame({ seq: 3, sourceKind: "presentation.run.error", runBindingRef: "run.01", event: { type: EventType.RUN_ERROR, message: "Safe failure.", code: "RUN_FAILED" } })),
      "agui_run_owner_terminal_conflict",
    );

    const matching = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(matching, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.02", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.02" } }));
    admitAfterExternalAck(matching, durableFrame({ seq: 2, sourceKind: "presentation.custom.run", runBindingRef: "run.02", event: { type: EventType.CUSTOM, name: "kokoro.run.replace.v1", value: { presentationRunId: "run.02", state: "finished", projectionVersion: 1 } } }));
    expect(admitAfterExternalAck(matching, durableFrame({ seq: 3, sourceKind: "presentation.run.finished", runBindingRef: "run.02", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.02" } }))).toMatchObject({ kind: "durable" });
  });

  it("locks CUSTOM message owner identity, version, and terminal lifecycle", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(decoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 3, sourceKind: "presentation.custom.message", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "message.01", role: "assistant", lifecycle: "streaming", parentPresentationMessageId: null, ordinal: 1, version: 1 } } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 4, sourceKind: "presentation.custom.message", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "message.01", role: "assistant", lifecycle: "streaming", parentPresentationMessageId: null, ordinal: 1, version: 1 } } }));
    expectCode(
      () => admitAfterExternalAck(decoder, durableFrame({ seq: 5, sourceKind: "presentation.custom.message", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "message.01", role: "assistant", lifecycle: "completed", parentPresentationMessageId: null, ordinal: 1, version: 1 } } })),
      "agui_message_owner_same_version_conflict",
    );
    expectCode(
      () => admitAfterExternalAck(decoder, durableFrame({ seq: 5, sourceKind: "presentation.custom.message", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "message.01", role: "assistant", lifecycle: "streaming", parentPresentationMessageId: "message.parent", ordinal: 1, version: 2 } } })),
      "agui_message_owner_identity_conflict",
    );

    const terminal = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(terminal, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.02", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.02" } }));
    admitAfterExternalAck(terminal, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.02", messageBindingRef: "message.02", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.02", role: "assistant" } }));
    admitAfterExternalAck(terminal, durableFrame({ seq: 3, sourceKind: "presentation.custom.message", runBindingRef: "run.02", messageBindingRef: "message.02", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "message.02", role: "assistant", lifecycle: "completed", parentPresentationMessageId: null, ordinal: 1, version: 1 } } }));
    expectCode(
      () => admitAfterExternalAck(terminal, durableFrame({ seq: 4, sourceKind: "presentation.custom.message", runBindingRef: "run.02", messageBindingRef: "message.02", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "message.02", role: "assistant", lifecycle: "streaming", parentPresentationMessageId: null, ordinal: 1, version: 2 } } })),
      "agui_message_owner_transition_invalid",
    );
    expectCode(
      () => admitAfterExternalAck(terminal, durableFrame({ seq: 4, sourceKind: "presentation.message.text.content", runBindingRef: "run.02", messageBindingRef: "message.02", event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId: "message.02", delta: "late" } })),
      "agui_message_owner_terminal_conflict",
    );
  });

  it("never reopens a CUSTOM message after native TEXT END", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    admitAfterExternalAck(decoder, durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    admitAfterExternalAck(decoder, durableFrame({ seq: 3, sourceKind: "presentation.message.text.ended", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_END, messageId: "message.01" } }));
    expectCode(
      () => admitAfterExternalAck(decoder, durableFrame({ seq: 4, sourceKind: "presentation.custom.message", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.CUSTOM, name: "kokoro.message.replace.v1", value: { presentationMessageId: "message.01", role: "assistant", lifecycle: "streaming", parentPresentationMessageId: null, ordinal: 1, version: 1 } } })),
      "agui_message_owner_terminal_conflict",
    );
  });

  it("reads hostile raw frame descriptors once and enforces exact UTF-8 boundaries", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    let getterCalls = 0;
    const accessor = Object.create(Object.prototype, {
      id: { enumerable: true, get() { getterCalls += 1; return "opaque.cursor.0001"; } },
      event: { enumerable: true, value: EventType.RUN_ERROR },
      data: { enumerable: true, value: "{}" },
    });
    expectCode(() => admitAfterExternalAck(decoder, accessor as AguiSseFrame), "agui_sse_frame_shape_invalid");
    expect(getterCalls).toBe(0);

    let ownKeysCalls = 0;
    const proxy = new Proxy({ id: "opaque.cursor.0001", event: EventType.RUN_ERROR, data: "{}" }, {
      ownKeys(target) {
        ownKeysCalls += 1;
        return Reflect.ownKeys(target);
      },
    });
    expectCode(() => admitAfterExternalAck(decoder, proxy), "agui_projection_payload_invalid");
    expect(ownKeysCalls).toBe(1);

    expectCode(
      () => admitAfterExternalAck(decoder, new Proxy({}, { ownKeys() { throw new Error("hostile"); } }) as AguiSseFrame),
      "agui_sse_frame_shape_invalid",
    );
    const symbolExtra = { id: "opaque.cursor.0001", event: EventType.RUN_ERROR, data: "{}", [Symbol("extra")]: true };
    expectCode(() => admitAfterExternalAck(decoder, symbolExtra), "agui_sse_frame_shape_invalid");
    const hiddenExtra = Object.create(Object.prototype, {
      id: { enumerable: true, value: "opaque.cursor.0001" },
      event: { enumerable: true, value: EventType.RUN_ERROR },
      data: { enumerable: true, value: "{}" },
      hidden: { enumerable: false, value: true },
    });
    expectCode(() => admitAfterExternalAck(decoder, hiddenExtra as AguiSseFrame), "agui_sse_frame_shape_invalid");

    const id = "opaque.cursor.0001";
    const event = EventType.RUN_ERROR;
    const prefix = '{"padding":"';
    const suffix = '"}';
    const fixedBytes = new TextEncoder().encode(id + event + prefix + suffix + "😀").byteLength;
    const padding = "a".repeat(AGUI_PRESENTATION_LIMITS.maximumFrameBytes - fixedBytes);
    const exact = { id, event, data: `${prefix}${padding}😀${suffix}` };
    expectCode(() => admitAfterExternalAck(decoder, exact), "agui_projection_payload_invalid");
    expectCode(() => admitAfterExternalAck(decoder, { ...exact, data: `${prefix}${padding}a😀${suffix}` }), "agui_frame_limit_exceeded");

    const loneSurrogate = { id, event, data: `${prefix}\ud800${suffix}` };
    expectCode(() => admitAfterExternalAck(decoder, loneSurrogate), "agui_projection_payload_invalid");
  });
});
