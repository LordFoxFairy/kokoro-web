import type { AguiPresentationSnapshotAuthority, AguiSseFrame } from "@kokoro/session-client/agui-presentation"
import type { SessionSnapshot } from "@kokoro/session-client/contracts"
import { describe, expect, it } from "vitest"

import fixtureJson from "../../session-client/test/fixtures/root-agui-presentation-v1.json"
import { createChatProjectionStore } from "../src/projection/store.js"
import { createAguiProjectionAdapter } from "../src/runtime/agui-presentation-adapter.js"
import type { ChatAguiPresentationMutation } from "../src/runtime/agui-presentation-adapter.js"

type FixtureFrame = Readonly<{ id: string; event: string; data: Readonly<Record<string, unknown>> }>
type FixtureCase = Readonly<{
  snapshot: Omit<AguiPresentationSnapshotAuthority, "runBindings" | "messageBindings">
  grantBinding: Parameters<typeof createAguiProjectionAdapter>[0]["grant"]
  frames: readonly FixtureFrame[]
}>

const contractCase = (fixtureJson as Readonly<{ positiveCases: readonly FixtureCase[] }>).positiveCases[0]
if (contractCase === undefined) throw new Error("Root AG-UI fixture missing")

function sessionSnapshot(): SessionSnapshot {
  return {
    session: {
      session_id: contractCase.grantBinding.sessionId,
      project_ref: "project.agui",
      title: "AG-UI",
      lifecycle: "active",
      context_policy: "standard",
      active_branch_id: "branch.agui",
      version: 1,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    branches: [{
      branch_id: "branch.agui",
      origin: "original",
      version: 1,
      created_at: "2026-08-01T00:00:00.000Z",
    }],
    messages: [],
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

function createActiveProjection() {
  const store = createChatProjectionStore()
  store.hydrate(sessionSnapshot())
  const adapter = createAguiProjectionAdapter({
    grant: contractCase.grantBinding,
    snapshotAuthority: { ...contractCase.snapshot, runBindings: [], messageBindings: [] },
    dispatch: store.dispatchPresentation,
  })
  return { adapter, store }
}

describe("production AG-UI Chat projection", () => {
  it("projects official text and every closed activity into the one ChatProjection authority", () => {
    const { adapter, store } = createActiveProjection()
    for (let sequence = 1; sequence <= 13; sequence += 1) adapter.accept(frame(sequence))

    const projection = store.getSnapshot()
    expect(projection.activeRunId).toBeNull()
    expect(projection.presentationRunId).toMatch(/^presentation\.run:/u)
    expect(projection.messages).toHaveLength(1)
    expect(projection.messages[0]).toMatchObject({
      id: expect.stringMatching(/^presentation\.message:/u),
      role: "assistant",
      status: "running",
      parts: [
        expect.objectContaining({ kind: "text" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.safe-summary.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.tool-preview.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.hitl.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.plan.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.subagent.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.media.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.artifact.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.cost.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.notice.v1" }),
        expect.objectContaining({ kind: "activity", activityType: "kokoro.error.v1" }),
      ],
    })
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

  it("tracks concurrent parent and child presentation runs by binding without inventing a Session run", () => {
    const store = createChatProjectionStore()
    store.hydrate(sessionSnapshot())
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
    } as unknown as ChatAguiPresentationMutation
    const child = {
      ...parent, cursor: "cursor.child", runBindingRef: "presentation.run-binding:child",
      runId: "presentation.run:child", parentRunId: "presentation.run:parent",
    } as unknown as ChatAguiPresentationMutation
    const childMessage = {
      type: "agui.text", phase: "start", durable: true, cursor: "cursor.message", source,
      runBindingRef: "presentation.run-binding:child",
      messageBindingRef: "presentation.message-binding:child",
      presentationMessageId: "presentation.message:child", role: "assistant",
    } as unknown as ChatAguiPresentationMutation
    const finishParent = {
      type: "agui.lifecycle", phase: "run-finished", durable: true, cursor: "cursor.parent.finished",
      source: { ...source, projectionVersion: "3" },
      runBindingRef: "presentation.run-binding:parent", threadId: "presentation.thread:test",
      runId: "presentation.run:parent",
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
    store.hydrate(sessionSnapshot())
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
    store.hydrate(sessionSnapshot())
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
    } as unknown as ChatAguiPresentationMutation
    const start = {
      type: "agui.text", phase: "start", durable: true, cursor: "cursor.text.start", source,
      runBindingRef: "presentation.run-binding:message",
      messageBindingRef: "presentation.message-binding:message",
      presentationMessageId: "presentation.message:message", role: "assistant",
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
})
