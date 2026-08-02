import type {
  AguiPresentationMessageBinding,
  AguiPresentationRunBinding,
  AguiPresentationSnapshotAuthority,
  AguiSseFrame,
} from "@kokoro/session-client/agui-presentation"
import type { SessionSnapshot } from "@kokoro/session-client/contracts"
import { describe, expect, it, vi } from "vitest"

import fixtureJson from "../../session-client/test/fixtures/root-agui-presentation-v1.json"
import { createChatProjectionStore } from "../src/projection/store.js"
import { createAguiProjectionAdapter } from "../src/runtime/agui-presentation-adapter.js"
import type { ChatAguiPresentationMutation } from "../src/runtime/agui-presentation-adapter.js"

type FixtureFrame = Readonly<{ id: string; event: string; data: Readonly<Record<string, unknown>> }>
type FixtureCase = Readonly<{
  snapshot: Omit<AguiPresentationSnapshotAuthority, "runBindings" | "messageBindings">
  grantBinding: Parameters<typeof createAguiProjectionAdapter>[0]["grant"]
  frames: readonly FixtureFrame[]
  runBindings: readonly AguiPresentationRunBinding[]
  messageBindings: readonly AguiPresentationMessageBinding[]
}>

const contractCase = (fixtureJson as unknown as Readonly<{ positiveCases: readonly FixtureCase[] }>).positiveCases[0]
if (contractCase === undefined) throw new Error("Root AG-UI fixture missing")

function sessionSnapshot(materializedAgui = false): SessionSnapshot {
  const runBinding = contractCase.runBindings[0]
  const messageBinding = contractCase.messageBindings[0]
  const hasMaterializedBinding = materializedAgui && runBinding?.sessionRunId !== null &&
    messageBinding?.sessionMessageId !== null && messageBinding?.sessionTextPartId !== null
  const messageId = hasMaterializedBinding ? messageBinding.sessionMessageId : undefined
  return {
    session: {
      session_id: contractCase.grantBinding.sessionId,
      project_ref: "project.agui",
      title: "AG-UI",
      lifecycle: "active",
      context_policy: "standard",
      active_branch_id: "branch.01",
      ...(messageId === undefined ? {} : { active_leaf_message_id: messageId }),
      version: 1,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    branches: [{
      branch_id: "branch.01",
      origin: "original",
      version: 1,
      created_at: "2026-08-01T00:00:00.000Z",
      ...(messageId === undefined ? {} : { root_message_id: messageId, leaf_message_id: messageId }),
    }],
    messages: hasMaterializedBinding ? [{
      message_id: messageBinding.sessionMessageId,
      branch_id: "branch.01",
      run_id: runBinding.sessionRunId,
      role: "assistant",
      ordinal: 0,
      lifecycle: "streaming",
      parts: [{
        part_id: messageBinding.sessionTextPartId,
        message_id: messageBinding.sessionMessageId,
        ordinal: 0,
        version: 1,
        schema_version: 1,
        lifecycle: "streaming",
        kind: "text",
        payload: { spans: [] },
      }, {
        part_id: "part.unrelated.agui",
        message_id: messageBinding.sessionMessageId,
        ordinal: 1,
        version: 1,
        schema_version: 1,
        lifecycle: "completed",
        kind: "text",
        payload: { spans: [{ text: "do not mutate" }] },
      }],
      attachments: [],
      created_at: "2026-08-01T12:00:02.000Z",
    }] : [],
    run_launches: [],
    runs: [],
    controls: [],
    costs: [],
    model_history: [],
    snapshot_watermark: {
      snapshot_revision_ref: "snapshot.revision.agui",
      projection_version: 1,
    },
    presentation_authority: {},
  }
}

function frame(sequence: number): AguiSseFrame {
  const candidate = contractCase.frames[sequence - 1]
  if (candidate === undefined) throw new Error(`Root AG-UI frame ${sequence} missing`)
  return { id: candidate.id, event: candidate.event, data: JSON.stringify(candidate.data) }
}

function authorityAfter(sequence: number): AguiPresentationSnapshotAuthority {
  const adapter = createAguiProjectionAdapter({
    grant: contractCase.grantBinding,
    snapshotAuthority: initialAuthority(),
    dispatch: () => "applied",
  })
  for (let index = 1; index <= sequence; index += 1) adapter.accept(frame(index))
  return adapter.getSnapshotAuthority()
}

function initialAuthority(): AguiPresentationSnapshotAuthority {
  return { ...contractCase.snapshot, runBindings: [], messageBindings: [] }
}

function createActiveProjection() {
  const store = createChatProjectionStore()
  const snapshotAuthority = initialAuthority()
  store.hydrate(sessionSnapshot(true), snapshotAuthority)
  const adapter = createAguiProjectionAdapter({
    grant: contractCase.grantBinding,
    snapshotAuthority,
    dispatch: store.dispatchPresentation,
  })
  return { adapter, store }
}

function explicitRunBinding(
  bindingRef: string,
  presentationRunId: string,
  sessionRunId: string | null,
  parentPresentationRunId: string | null = null,
) {
  return {
    bindingRef,
    presentationRunId,
    sessionRunId,
    sessionId: contractCase.grantBinding.sessionId,
    parentLineage: { parentPresentationRunId },
  }
}

function explicitMessageBinding(
  bindingRef: string,
  runBindingRef: string,
  presentationMessageId: string,
  sessionMessageId: string | null = null,
  sessionTextPartId: string | null = null,
) {
  return {
    bindingRef,
    presentationRunBindingRef: runBindingRef,
    presentationMessageId,
    sessionMessageId,
    sessionTextPartId,
  }
}

describe("production AG-UI Chat projection", () => {
  it("continues text from a nonzero presentation snapshot without entering repair", () => {
    const authority = authorityAfter(2)
    const store = createChatProjectionStore()
    store.hydrate(sessionSnapshot(true), authority)
    const adapter = createAguiProjectionAdapter({
      grant: contractCase.grantBinding,
      snapshotAuthority: authority,
      dispatch: store.dispatchPresentation,
    })

    expect(adapter.accept(frame(3))).toEqual({ kind: "durable" })
    expect(store.getSnapshot()).toMatchObject({
      repair: { required: false },
      presentationRuns: [expect.objectContaining({
        bindingRef: authority.runBindings[0]?.bindingRef,
        sessionRunId: authority.runBindings[0]?.sessionRunId,
      })],
      presentationControls: [],
      presentationReceipts: [],
      messages: [expect.objectContaining({
        id: authority.messageBindings[0]?.sessionMessageId,
        presentationMessageId: authority.messageBindings[0]?.presentationMessageId,
        presentationMessageBindingRef: authority.messageBindings[0]?.bindingRef,
        parts: expect.arrayContaining([
          expect.objectContaining({
            id: authority.messageBindings[0]?.sessionTextPartId,
            kind: "text",
            text: "I can help with that.",
          }),
        ]),
      })],
    })
    expect(store.getSnapshot().presentationRuns[0]).not.toHaveProperty("ownerVersion")
  })

  it("continues a message owner replacement from a nonzero presentation snapshot", () => {
    const authority = authorityAfter(15)
    const store = createChatProjectionStore()
    store.hydrate(sessionSnapshot(true), authority)
    const adapter = createAguiProjectionAdapter({
      grant: contractCase.grantBinding,
      snapshotAuthority: authority,
      dispatch: store.dispatchPresentation,
    })

    expect(adapter.accept(frame(16))).toEqual({ kind: "durable" })
    expect(store.getSnapshot()).toMatchObject({
      repair: { required: false },
      messages: [expect.objectContaining({
        presentationMessageVersion: 3,
        status: "running",
      })],
    })
  })

  it("fails closed when a presentation snapshot points at a different Session text owner", () => {
    const authority = authorityAfter(2)
    const message = authority.messageBindings[0]
    if (message === undefined) throw new Error("AG-UI message binding missing")
    const conflictingAuthority: AguiPresentationSnapshotAuthority = {
      ...authority,
      messageBindings: [{ ...message, sessionTextPartId: "part.different-owner" }],
    }
    const store = createChatProjectionStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.hydrate(sessionSnapshot(true), conflictingAuthority)

    expect(store.getSnapshot()).toMatchObject({
      presentationRuns: [],
      repair: { required: true, reason: "agui_snapshot_message_text_owner_conflict" },
    })
    const adapter = createAguiProjectionAdapter({
      grant: contractCase.grantBinding,
      snapshotAuthority: conflictingAuthority,
      dispatch: store.dispatchPresentation,
    })
    expect(() => adapter.accept(frame(3))).toThrow("agui_projection_rejected")
    expect(listener).toHaveBeenCalledOnce()
    expect(store.getSnapshot().repair).toEqual({
      required: true,
      reason: "agui_snapshot_message_text_owner_conflict",
    })
  })

  it("fails closed when a nonzero snapshot omits the current message authority", () => {
    const authority = authorityAfter(2)
    const store = createChatProjectionStore()

    store.hydrate(sessionSnapshot(true), { ...authority, messageBindings: [] })

    expect(store.getSnapshot()).toMatchObject({
      presentationRuns: [],
      repair: { required: true, reason: "agui_snapshot_message_authority_missing" },
    })
  })

  it("fails closed when Session text is open after its presentation binding ended", () => {
    const authority = authorityAfter(20)
    const store = createChatProjectionStore()

    store.hydrate(sessionSnapshot(true), authority)

    expect(store.getSnapshot()).toMatchObject({
      presentationRuns: [],
      repair: { required: true, reason: "agui_snapshot_message_terminal_conflict" },
    })
  })

  it("projects official text and every closed activity into the one ChatProjection authority", () => {
    const { adapter, store } = createActiveProjection()
    for (let sequence = 1; sequence <= 19; sequence += 1) {
      try {
        adapter.accept(frame(sequence))
      } catch (error) {
        throw new Error(`frame ${sequence} rejected: ${store.getSnapshot().repair.reason}`, { cause: error })
      }
    }

    const projection = store.getSnapshot()
    expect(projection.activeRunId).toBeNull()
    expect(projection.presentationRunId).toMatch(/^presentation\.run:/u)
    expect(projection.messages).toHaveLength(1)
    expect(projection.messages[0]).toMatchObject({
      id: expect.stringMatching(/^session\.message:/u),
      presentationMessageId: expect.stringMatching(/^presentation\.message:/u),
      runId: expect.stringMatching(/^session\.run:/u),
      role: "assistant",
      status: "running",
      parts: expect.arrayContaining([
        expect.objectContaining({ kind: "text" }),
        expect.objectContaining({ kind: "reasoning-summary", ownerVersion: "1" }),
        expect.objectContaining({ kind: "tool", ownerVersion: "1" }),
        expect.objectContaining({ kind: "approval", ownerVersion: "1", controlRef: "control.01" }),
        expect.objectContaining({ kind: "plan-progress", ownerVersion: "1" }),
        expect.objectContaining({ kind: "subagent", ownerVersion: "1" }),
        expect.objectContaining({ kind: "media-operation", ownerVersion: "1" }),
        expect.objectContaining({ kind: "artifact", ownerVersion: "1", mediaClass: "image" }),
        expect.objectContaining({ kind: "cost", ownerVersion: "1" }),
        expect.objectContaining({ kind: "notice", ownerVersion: "1" }),
        expect.objectContaining({ kind: "error", ownerVersion: "1" }),
      ]),
    })
    expect(projection.messages[0]?.parts.find((part) => part.id === "part.unrelated.agui")).toMatchObject({
      kind: "text",
      text: "do not mutate",
    })
    expect(projection.presentationRuns[0]).toMatchObject({
      state: "waiting",
      ownerVersion: "18446744073709551615",
    })
    expect(projection.presentationControls).toEqual([
      expect.objectContaining({ controlRef: "control.01", ownerVersion: "1", allowedActions: ["approve", "reject"] }),
    ])
    expect(projection.presentationReceipts).toEqual([
      expect.objectContaining({ receiptRef: "receipt.01", ownerVersion: "2", state: "committed" }),
    ])
    expect(projection.messages[0]?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "approval",
        controlOwnerVersion: "1",
        receiptRef: "receipt.01",
        receiptOwnerVersion: "2",
        receiptState: "committed",
      }),
    ]))
  })

  it("acknowledges exact cursor replay without applying the presentation twice", () => {
    const { adapter, store } = createActiveProjection()
    adapter.accept(frame(1))
    adapter.accept(frame(2))
    adapter.accept(frame(3))
    const before = store.getSnapshot()

    adapter.accept(frame(3))

    expect(store.getSnapshot()).toBe(before)
  })

  it("rejects same-owner-version semantic conflicts", () => {
    const { adapter, store } = createActiveProjection()
    for (let sequence = 1; sequence <= 9; sequence += 1) adapter.accept(frame(sequence))
    const message = store.getSnapshot().messages[0]
    if (message?.presentationMessageId === undefined || message.presentationRunBindingRef === undefined ||
      message.presentationMessageBindingRef === undefined) throw new Error("AG-UI owner binding missing")
    const source = {
      sourceEventId: "presentation.event:owner-version-conflict-0000000001",
      sourceKind: "presentation.test",
      projectionVersion: "10",
      recordedAt: "2026-08-01T12:00:10.000Z",
      durableSeq: "10",
    }
    const media = {
      type: "agui.activity", durable: true, cursor: "cursor.owner.retry", source,
      runBindingRef: message.presentationRunBindingRef,
      messageBindingRef: message.presentationMessageBindingRef,
      presentationMessageId: message.presentationMessageId,
      activityType: "kokoro.media.v1", replace: true,
      content: {
        mediaOperationRef: "media-operation.01",
        definitionRef: "media-definition.image.generate",
        definitionRevisionRef: "media-definition-revision.image.generate.01",
        ownerVersion: "1",
        state: "active",
        progressBps: 5000,
        candidates: [{ candidateRef: "media-candidate.01", ordinal: 0, ownerVersion: "1", state: "producing" }],
        updatedAt: "2026-08-01T12:00:10.000Z",
      },
    } as unknown as ChatAguiPresentationMutation

    expect(store.dispatchPresentation(media)).toBe("rejected")
    expect(store.getSnapshot().repair.reason).toBe("agui_activity_owner_version_conflict")
  })

  it("keeps committed receipt authority terminal", () => {
    const { adapter, store } = createActiveProjection()
    for (let sequence = 1; sequence <= 19; sequence += 1) adapter.accept(frame(sequence))
    const runBindingRef = store.getSnapshot().presentationRuns[0]?.bindingRef
    if (runBindingRef === undefined) throw new Error("AG-UI run binding missing")
    expect(store.dispatchPresentation({
      type: "agui.custom",
      durable: true,
      cursor: "cursor.receipt.regression",
      source: {
        sourceEventId: "presentation.event:receipt-regression-0000000001",
        sourceKind: "presentation.test",
        projectionVersion: "20",
        recordedAt: "2026-08-01T12:00:20.000Z",
        durableSeq: "20",
      },
      runBindingRef,
      name: "kokoro.receipt.replace.v1",
      value: {
        receiptRef: "receipt.01",
        controlRef: "control.01",
        ownerRef: "decision.01",
        decisionGroupRef: "decision-group.01",
        commandId: "command.01",
        operation: "approve",
        state: "pending",
        ownerVersion: "3",
        updatedAt: "2026-08-01T12:00:20.000Z",
      },
    } as unknown as ChatAguiPresentationMutation)).toBe("rejected")
    expect(store.getSnapshot().repair.reason).toBe("agui_receipt_terminal_regression")
  })

  it("tracks concurrent parent and child presentation runs by binding without inventing a Session run", () => {
    const store = createChatProjectionStore()
    store.hydrate(sessionSnapshot(), initialAuthority())
    const source = {
      sourceEventId: "presentation.event:test-event-00000000000000000001",
      sourceKind: "presentation.test",
      projectionVersion: "1",
      recordedAt: "2026-08-01T12:00:00.000Z",
      durableSeq: "1",
    }
    const parent = {
      type: "agui.lifecycle", phase: "run-started", durable: true, cursor: "cursor.parent",
      source, runBindingRef: "presentation.run-binding:parent", threadId: "presentation.thread:test",
      runId: "presentation.run:parent",
      runBinding: explicitRunBinding(
        "presentation.run-binding:parent", "presentation.run:parent", "session.run:parent",
      ),
    } as unknown as ChatAguiPresentationMutation
    const child = {
      ...parent, cursor: "cursor.child", runBindingRef: "presentation.run-binding:child",
      runId: "presentation.run:child", parentRunId: "presentation.run:parent",
      runBinding: explicitRunBinding(
        "presentation.run-binding:child", "presentation.run:child", null, "presentation.run:parent",
      ),
    } as unknown as ChatAguiPresentationMutation
    const childMessage = {
      type: "agui.text", phase: "start", durable: true, cursor: "cursor.message", source,
      runBindingRef: "presentation.run-binding:child",
      messageBindingRef: "presentation.message-binding:child",
      presentationMessageId: "presentation.message:child", role: "assistant",
      runBinding: explicitRunBinding(
        "presentation.run-binding:child", "presentation.run:child", null, "presentation.run:parent",
      ),
      messageBinding: explicitMessageBinding(
        "presentation.message-binding:child", "presentation.run-binding:child", "presentation.message:child",
      ),
    } as unknown as ChatAguiPresentationMutation
    const finishParent = {
      type: "agui.lifecycle", phase: "run-finished", durable: true, cursor: "cursor.parent.finished",
      source: { ...source, projectionVersion: "3" },
      runBindingRef: "presentation.run-binding:parent", threadId: "presentation.thread:test",
      runId: "presentation.run:parent",
      runBinding: explicitRunBinding(
        "presentation.run-binding:parent", "presentation.run:parent", "session.run:parent",
      ),
    } as unknown as ChatAguiPresentationMutation

    expect(store.dispatchPresentation(parent)).toBe("applied")
    expect(store.dispatchPresentation(child)).toBe("applied")
    expect(store.dispatchPresentation(childMessage)).toBe("applied")
    expect(store.dispatchPresentation(finishParent)).toBe("applied")

    expect(store.getSnapshot().presentationRuns).toEqual([
      expect.objectContaining({ bindingRef: "presentation.run-binding:parent", state: "finished" }),
      expect.objectContaining({
        bindingRef: "presentation.run-binding:child",
        parentPresentationRunId: "presentation.run:parent",
        state: "running",
      }),
    ])
    expect(store.getSnapshot().messages[0]).toMatchObject({
      runId: null,
      presentationRunId: "presentation.run:child",
      presentationRunBindingRef: "presentation.run-binding:child",
      presentationMessageBindingRef: "presentation.message-binding:child",
      status: "running",
    })
  })

  it("rejects a terminal presentation run regression without recording its cursor", () => {
    const store = createChatProjectionStore()
    store.hydrate(sessionSnapshot(), initialAuthority())
    const source = {
      sourceEventId: "presentation.event:test-event-00000000000000000002",
      sourceKind: "presentation.test",
      projectionVersion: "2",
      recordedAt: "2026-08-01T12:00:00.000Z",
      durableSeq: "2",
    }
    const started = {
      type: "agui.lifecycle", phase: "run-started", durable: true, cursor: "cursor.started", source,
      runBindingRef: "presentation.run-binding:sealed", threadId: "presentation.thread:test",
      runId: "presentation.run:sealed",
      runBinding: explicitRunBinding(
        "presentation.run-binding:sealed", "presentation.run:sealed", "session.run:sealed",
      ),
    } as unknown as ChatAguiPresentationMutation
    const finished = {
      ...started, phase: "run-finished", cursor: "cursor.finished",
      source: { ...source, projectionVersion: "3" },
    } as unknown as ChatAguiPresentationMutation
    const regression = {
      ...started, cursor: "cursor.regression", source: { ...source, projectionVersion: "4" },
    } as unknown as ChatAguiPresentationMutation

    expect(store.dispatchPresentation(started)).toBe("applied")
    expect(store.dispatchPresentation(finished)).toBe("applied")
    expect(store.dispatchPresentation(regression)).toBe("rejected")
    expect(store.getSnapshot()).toMatchObject({
      presentationRuns: [expect.objectContaining({ state: "finished" })],
      repair: { required: true, reason: "agui_run_terminal_regression" },
    })
  })

  it("seals ended presentation messages against late content and binding drift", () => {
    const store = createChatProjectionStore()
    store.hydrate(sessionSnapshot(), initialAuthority())
    const source = {
      sourceEventId: "presentation.event:test-event-00000000000000000003",
      sourceKind: "presentation.test",
      projectionVersion: "3",
      recordedAt: "2026-08-01T12:00:00.000Z",
      durableSeq: "3",
    }
    const run = {
      type: "agui.lifecycle", phase: "run-started", durable: true, cursor: "cursor.run", source,
      runBindingRef: "presentation.run-binding:message", threadId: "presentation.thread:test",
      runId: "presentation.run:message",
      runBinding: explicitRunBinding(
        "presentation.run-binding:message", "presentation.run:message", "session.run:message",
      ),
    } as unknown as ChatAguiPresentationMutation
    const start = {
      type: "agui.text", phase: "start", durable: true, cursor: "cursor.text.start", source,
      runBindingRef: "presentation.run-binding:message",
      messageBindingRef: "presentation.message-binding:message",
      presentationMessageId: "presentation.message:message", role: "assistant",
      runBinding: explicitRunBinding(
        "presentation.run-binding:message", "presentation.run:message", "session.run:message",
      ),
      messageBinding: explicitMessageBinding(
        "presentation.message-binding:message", "presentation.run-binding:message", "presentation.message:message",
      ),
    } as unknown as ChatAguiPresentationMutation
    const end = {
      ...start, phase: "end", cursor: "cursor.text.end",
      source: { ...source, projectionVersion: "4" },
    } as unknown as ChatAguiPresentationMutation
    const late = {
      ...start, phase: "content", cursor: "cursor.text.late", delta: "late",
      source: { ...source, projectionVersion: "5" },
    } as unknown as ChatAguiPresentationMutation

    expect(store.dispatchPresentation(run)).toBe("applied")
    expect(store.dispatchPresentation(start)).toBe("applied")
    expect(store.dispatchPresentation(end)).toBe("applied")
    expect(store.dispatchPresentation(late)).toBe("rejected")
    expect(store.getSnapshot()).toMatchObject({
      messages: [{ status: "complete", parts: [{ kind: "text", text: "" }] }],
      repair: { required: true, reason: "agui_message_terminal_regression" },
    })
  })

  it("rejects a CUSTOM message lifecycle regression after terminal replacement", () => {
    const store = createChatProjectionStore()
    store.hydrate(sessionSnapshot(), initialAuthority())
    const source = {
      sourceEventId: "presentation.event:test-event-00000000000000000004",
      sourceKind: "presentation.test",
      projectionVersion: "1",
      recordedAt: "2026-08-01T12:00:00.000Z",
      durableSeq: "1",
    }
    const authority = {
      durable: true, source,
      runBindingRef: "presentation.run-binding:custom-message",
      runBinding: explicitRunBinding(
        "presentation.run-binding:custom-message", "presentation.run:custom-message", "session.run:custom-message",
      ),
    }
    expect(store.dispatchPresentation({
      ...authority, type: "agui.lifecycle", phase: "run-started", cursor: "cursor.custom.run",
      threadId: "presentation.thread:test", runId: "presentation.run:custom-message",
    } as unknown as ChatAguiPresentationMutation)).toBe("applied")
    const messageAuthority = {
      ...authority,
      messageBindingRef: "presentation.message-binding:custom-message",
      messageBinding: explicitMessageBinding(
        "presentation.message-binding:custom-message",
        "presentation.run-binding:custom-message",
        "presentation.message:custom-message",
      ),
    }
    expect(store.dispatchPresentation({
      ...messageAuthority, type: "agui.text", phase: "start", cursor: "cursor.custom.start",
      source: { ...source, projectionVersion: "2" },
      presentationMessageId: "presentation.message:custom-message", role: "assistant",
    } as unknown as ChatAguiPresentationMutation)).toBe("applied")
    expect(store.dispatchPresentation({
      ...messageAuthority, type: "agui.custom", name: "kokoro.message.replace.v1",
      cursor: "cursor.custom.complete", source: { ...source, projectionVersion: "3" },
      value: {
        presentationMessageId: "presentation.message:custom-message", role: "assistant",
        lifecycle: "completed", parentPresentationMessageId: null, ordinal: 0, version: 1,
      },
    } as unknown as ChatAguiPresentationMutation)).toBe("applied")
    expect(store.dispatchPresentation({
      ...messageAuthority, type: "agui.custom", name: "kokoro.message.replace.v1",
      cursor: "cursor.custom.regression", source: { ...source, projectionVersion: "4" },
      value: {
        presentationMessageId: "presentation.message:custom-message", role: "assistant",
        lifecycle: "streaming", parentPresentationMessageId: null, ordinal: 0, version: 2,
      },
    } as unknown as ChatAguiPresentationMutation)).toBe("rejected")
    expect(store.getSnapshot().repair).toEqual({
      required: true,
      reason: "agui_message_terminal_regression",
    })
  })
})
