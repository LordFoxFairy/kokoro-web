import { EventType } from "@ag-ui/core";
import { describe, expect, it } from "vitest";

import {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_PROFILE_REVISION,
  SESSION_AGUI_CONTRACT_REVISION,
  AguiPresentationProtocolError,
  createAguiPresentationDecoder,
  type AguiGrantBinding,
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

describe("strict Session-owned AG-UI decoder", () => {
  it("preserves the Root profile, SSE identity, and Last-Event-ID binding", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const decoded = decoder.decode(durableFrame({
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

    expect(frames.map((frame) => decoder.decode(frame).kind)).toEqual(Array.from({ length: 26 }, () => "durable"));
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
      expectCode(() => createAguiPresentationDecoder({ grant, initialCursor }).decode({ ...base, data: JSON.stringify(candidate) }), expectedCode);
      expect(name).toBeTruthy();
    }

    const wrongType = { ...base, event: EventType.RUN_FINISHED };
    expectCode(() => createAguiPresentationDecoder({ grant, initialCursor }).decode(wrongType), "agui_sse_event_type_mismatch");

    const wrongCustom = durableFrame({ seq: 1, sourceKind: "presentation.custom.session", event: { type: EventType.CUSTOM, name: "vendor.unregistered", value: {} } });
    expectCode(() => createAguiPresentationDecoder({ grant, initialCursor }).decode(wrongCustom), "agui_unknown_custom");

    const wrongTool = durableFrame({ seq: 1, sourceKind: "presentation.activity.tool-preview", runBindingRef: "run-binding.01.segment.0", messageBindingRef: "message-binding.01.segment.0", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "presentation.message.01.segment.0", activityType: "kokoro.tool-preview.v1", content: { toolCallRef: "tool.01", label: "Search", status: "running", apiKey: "secret" }, replace: true } });
    expectCode(() => createAguiPresentationDecoder({ grant, initialCursor }).decode(wrongTool), "agui_tool_secret_forbidden");
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
        () => createAguiPresentationDecoder({ grant, initialCursor }).decode(frame),
        "agui_event_type_forbidden",
      );
    }
  });

  it("rejects cursor gaps, epoch or Session scope drift, and duplicate identities", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    const first = durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "presentation.run.01" } });
    decoder.decode(first);

    const gap = durableFrame({ seq: 3, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "presentation.run.01" } });
    expectCode(() => decoder.decode(gap), "agui_cursor_gap");

    const crossSession = durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", sessionId: "session.other", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "presentation.run.01" } });
    expectCode(() => decoder.decode(crossSession), "agui_stream_scope_conflict");

    const wrongEpoch = durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", streamEpoch: "42", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "presentation.run.01" } });
    expectCode(() => decoder.decode(wrongEpoch), "agui_stream_scope_conflict");
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
    for (const frame of frames) decoder.decode(frame);

    const reopenEnded = durableFrame({ seq: 7, sourceKind: "presentation.message.text.started", runBindingRef: "run.segment.1", messageBindingRef: "message.reused", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.segment.0", role: "assistant" } });
    expectCode(() => decoder.decode(reopenEnded), "agui_message_reopened");

    const reviveRun = durableFrame({ seq: 7, sourceKind: "presentation.run.started", runBindingRef: "run.segment.0", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.segment.0" } });
    expectCode(() => decoder.decode(reviveRun), "agui_terminal_run_revived");
  });

  it("locks presentation thread scope and validates visible parent run lineage", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    decoder.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "parent.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.parent.01" } }));
    decoder.decode(durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "parent.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.parent.01" } }));
    expect(decoder.decode(durableFrame({ seq: 3, sourceKind: "presentation.run.started", runBindingRef: "child.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.child.01", parentRunId: "run.parent.01" } }))).toMatchObject({ kind: "durable" });

    const missingParent = createAguiPresentationDecoder({ grant, initialCursor });
    expectCode(() => missingParent.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "child.02", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.child.02", parentRunId: "run.other-session" } })), "agui_run_parent_lineage_conflict");

    const selfParent = createAguiPresentationDecoder({ grant, initialCursor });
    expectCode(() => selfParent.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "child.03", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.child.03", parentRunId: "run.child.03" } })), "agui_run_parent_lineage_conflict");

    expectCode(() => decoder.decode(durableFrame({ seq: 4, sourceKind: "presentation.run.started", runBindingRef: "run.thread-drift", event: { type: EventType.RUN_STARTED, threadId: "thread.other", runId: "run.thread-drift" } })), "agui_run_thread_scope_conflict");
  });

  it("rejects terminal run evidence while one of its messages remains open", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    decoder.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    decoder.decode(durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    expectCode(() => decoder.decode(durableFrame({ seq: 3, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.01" } })), "agui_run_message_open");

    const errorDecoder = createAguiPresentationDecoder({ grant, initialCursor });
    errorDecoder.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.error", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.error" } }));
    errorDecoder.decode(durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.error", messageBindingRef: "message.error", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.error", role: "assistant" } }));
    expectCode(() => errorDecoder.decode(durableFrame({ seq: 3, sourceKind: "presentation.run.error", runBindingRef: "run.error", event: { type: EventType.RUN_ERROR, message: "Safe failure.", code: "RUN_FAILED" } })), "agui_run_message_open");
  });

  it("fails closed instead of evicting durable identity and terminal authority", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor, authorityLimit: 2 });
    decoder.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    expectCode(() => decoder.decode(durableFrame({ seq: 2, sourceKind: "presentation.run.finished", runBindingRef: "run.01", event: { type: EventType.RUN_FINISHED, threadId: "thread.01", runId: "run.01" } })), "agui_authority_capacity_exceeded");
    expect(decoder.getResumeRequest()).toMatchObject({ cursorBinding: { durableSeq: "1" } });
  });

  it("keeps stream.draining non-durable and bound to the last cursor", () => {
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    decoder.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    const before = decoder.getResumeRequest();
    const draining = decoder.decode({
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
    decoder.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    decoder.decode(durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
    const decoded = decoder.decode(durableFrame({ seq: 3, sourceKind: "presentation.activity.tool-preview", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.ACTIVITY_SNAPSHOT, messageId: "message.01", activityType: "kokoro.tool-preview.v1", content: { toolCallRef: "tool.01", label: "Search", status: "running" }, replace: true } }));
    if (decoded.kind !== "durable" || decoded.data.event.type !== EventType.ACTIVITY_SNAPSHOT) throw new Error("fixture mismatch");
    const unsafe = decoded.data.event.content as { apiKey?: string };
    expect(() => { unsafe.apiKey = "injected-secret"; }).toThrow(TypeError);
    expect(unsafe).not.toHaveProperty("apiKey");
  });

  it("enforces frame, event, depth, node, key, array, id, and cursor budgets before official parsing", () => {
    const oversized = "x".repeat(131_072);
    const decoder = createAguiPresentationDecoder({ grant, initialCursor });
    expectCode(() => decoder.decode({ id: "opaque.cursor.0001", event: EventType.RUN_ERROR, data: oversized }), "agui_frame_limit_exceeded");

    const deeplyNested = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", event: { type: EventType.RUN_ERROR, message: "Safe", code: "RUN_FAILED" } });
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 14; depth += 1) nested = { nested };
    const parsed = JSON.parse(deeplyNested.data) as Record<string, unknown>;
    parsed.extra = nested;
    expectCode(() => decoder.decode({ ...deeplyNested, data: JSON.stringify(parsed) }), "agui_frame_limit_exceeded");

    const tooManyNodes = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", event: { type: EventType.RUN_ERROR, message: "Safe", code: "RUN_FAILED" } });
    const nodePayload = JSON.parse(tooManyNodes.data) as Record<string, unknown>;
    nodePayload.extra = Array.from({ length: 256 }, () => Array.from({ length: 16 }, () => 1));
    expectCode(() => decoder.decode({ ...tooManyNodes, data: JSON.stringify(nodePayload) }), "agui_frame_limit_exceeded");

    const eventLimitDecoder = createAguiPresentationDecoder({ grant, initialCursor });
    eventLimitDecoder.decode(durableFrame({ seq: 1, sourceKind: "presentation.run.started", runBindingRef: "run.01", event: { type: EventType.RUN_STARTED, threadId: "thread.01", runId: "run.01" } }));
    eventLimitDecoder.decode(durableFrame({ seq: 2, sourceKind: "presentation.message.text.started", runBindingRef: "run.01", messageBindingRef: "message.01", event: { type: EventType.TEXT_MESSAGE_START, messageId: "message.01", role: "assistant" } }));
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
    expectCode(() => eventLimitDecoder.decode(hugePlan), "agui_event_limit_exceeded");

    const tooManyKeys = JSON.parse(tooManyNodes.data) as Record<string, unknown>;
    for (let index = 0; index < 65; index += 1) tooManyKeys[`extra${index}`] = index;
    expectCode(() => decoder.decode({ ...tooManyNodes, data: JSON.stringify(tooManyKeys) }), "agui_frame_limit_exceeded");

    const tooManyItems = JSON.parse(tooManyNodes.data) as Record<string, unknown>;
    tooManyItems.extra = Array.from({ length: 257 }, () => 1);
    expectCode(() => decoder.decode({ ...tooManyNodes, data: JSON.stringify(tooManyItems) }), "agui_frame_limit_exceeded");

    const longId = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", event: { type: EventType.RUN_ERROR, message: "Safe", code: "R".repeat(129) } });
    expectCode(() => decoder.decode(longId), "agui_event_shape_invalid");

    const longCursor = durableFrame({ seq: 1, sourceKind: "presentation.run.error", runBindingRef: "run.01", cursor: `opaque.${"x".repeat(2_050)}`, event: { type: EventType.RUN_ERROR, message: "Safe", code: "RUN_FAILED" } });
    expectCode(() => decoder.decode(longCursor), "agui_cursor_invalid");
  });
});
