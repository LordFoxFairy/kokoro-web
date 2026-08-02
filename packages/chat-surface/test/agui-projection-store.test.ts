import type { AguiPresentationSnapshotAuthority, AguiSseFrame } from "@kokoro/session-client/agui-presentation"
import type { SessionSnapshot } from "@kokoro/session-client/contracts"
import { describe, expect, it } from "vitest"

import fixtureJson from "../../session-client/test/fixtures/root-agui-presentation-v1.json"
import { createChatProjectionStore } from "../src/projection/store.js"
import { createAguiProjectionAdapter } from "../src/runtime/agui-presentation-adapter.js"

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
})
