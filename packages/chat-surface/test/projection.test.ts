import type { SessionEvent, SessionSnapshot } from "@kokoro/session-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { createChatProjectionStore } from "../src/projection/store.js"
import { createKokoroExternalStoreAdapter } from "../src/runtime/kokoro-external-store-adapter.js"

const NOW = "2026-07-28T00:00:00.000Z"

function snapshot(): SessionSnapshot {
  return {
    session: {
      session_id: "session-12345678",
      project_ref: "project-12345678",
      title: "Thread",
      lifecycle: "active",
      active_branch_id: "branch-12345678",
      active_leaf_message_id: "message-assistant-12345678",
      version: 2,
      created_at: NOW,
      updated_at: NOW,
    },
    branches: [{
      branch_id: "branch-12345678",
      root_message_id: "message-user-12345678",
      leaf_message_id: "message-assistant-12345678",
      origin: "original",
      version: 2,
      created_at: NOW,
    }],
    messages: [{
      message_id: "message-user-12345678",
      branch_id: "branch-12345678",
      role: "user",
      ordinal: 0,
      lifecycle: "completed",
      parts: [{
        part_id: "part-user-12345678",
        message_id: "message-user-12345678",
        ordinal: 0,
        version: 1,
        schema_version: 1,
        lifecycle: "completed",
        kind: "text",
        payload: { spans: [{ text: "hello" }] },
      }],
      attachments: [],
      created_at: NOW,
    }, {
      message_id: "message-assistant-12345678",
      branch_id: "branch-12345678",
      parent_message_id: "message-user-12345678",
      role: "assistant",
      ordinal: 1,
      run_id: "run-12345678",
      lifecycle: "streaming",
      parts: [{
        part_id: "part-assistant-12345678",
        message_id: "message-assistant-12345678",
        ordinal: 0,
        version: 1,
        schema_version: 1,
        lifecycle: "streaming",
        kind: "text",
        payload: { spans: [{ text: "hi" }] },
      }],
      attachments: [],
      created_at: NOW,
    }],
    run_launches: [],
    runs: [{
      run_id: "run-12345678",
      launch_id: "launch-12345678",
      branch_id: "branch-12345678",
      assistant_message_id: "message-assistant-12345678",
      execution_status: "running",
      cost_status: "committed",
      last_durable_cursor: "signed.cursor.7",
      projection_version: 2,
    }],
    controls: [],
    costs: [],
    model_history: [],
    snapshot_watermark: {
      cursor: "signed.cursor.7",
      stream_epoch: "epoch-12345678",
      durable_seq: "7",
      projection_version: 2,
    },
  }
}

function event<Event extends SessionEvent>(value: Omit<Event, keyof SessionEvent>): Event {
  return {
    event_id: "event-12345678",
    cursor: "signed.cursor.8",
    session_id: "session-12345678",
    stream_epoch: "epoch-12345678",
    durable_seq: "8",
    projection_version: 3,
    schema_revision: 3,
    recorded_at: NOW,
    ...value,
  } as Event
}

describe("Chat projection", () => {
  it("rehydrates the active v3 message lineage and active run without legacy repair", () => {
    const store = createChatProjectionStore()

    store.dispatch({ type: "snapshot", snapshot: snapshot() })

    expect(store.getSnapshot()).toMatchObject({
      activeRunId: "run-12345678",
      repair: { required: false },
      messages: [{
        id: "message-user-12345678",
        role: "user",
        status: "complete",
        parts: [{ kind: "text", text: "hello" }],
      }, {
        id: "message-assistant-12345678",
        role: "assistant",
        status: "running",
        parts: [{ kind: "text", text: "hi" }],
      }],
    })
  })

  it("replaces a versioned v3 part projection instead of appending legacy deltas", () => {
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: snapshot() })
    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            part_id: "part-assistant-12345678",
            message_id: "message-assistant-12345678",
            ordinal: 0,
            version: 2,
            schema_version: 1,
            lifecycle: "completed",
            kind: "text",
            payload: { spans: [{ text: "hi there" }] },
          },
        },
      }),
    })

    expect(store.getSnapshot().messages[1]?.parts).toEqual([
      expect.objectContaining({ kind: "text", id: "part-assistant-12345678", text: "hi there", version: 2, ordinal: 0 }),
    ])
  })

  it("requests snapshot repair without applying a part version gap", () => {
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: snapshot() })
    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            part_id: "part-assistant-12345678",
            message_id: "message-assistant-12345678",
            ordinal: 0,
            version: 3,
            schema_version: 1,
            lifecycle: "completed",
            kind: "text",
            payload: { spans: [{ text: "skipped version" }] },
          },
        },
      }),
    })

    expect(store.getSnapshot().messages[1]?.parts[0]).toMatchObject({ text: "hi", version: 1 })
    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "part_version_gap" })

    const unseenPartStore = createChatProjectionStore()
    unseenPartStore.dispatch({ type: "snapshot", snapshot: snapshot() })
    unseenPartStore.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            part_id: "part-new-12345678",
            message_id: "message-assistant-12345678",
            ordinal: 1,
            version: 2,
            schema_version: 1,
            lifecycle: "streaming",
            kind: "text",
            payload: { spans: [{ text: "missing first version" }] },
          },
        },
      }),
    })

    expect(unseenPartStore.getSnapshot().messages[1]?.parts).toHaveLength(1)
    expect(unseenPartStore.getSnapshot().repair).toEqual({ required: true, reason: "part_version_gap" })
  })

  it("requests snapshot repair without applying part identity drift", () => {
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: snapshot() })
    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            part_id: "part-assistant-12345678",
            message_id: "message-assistant-12345678",
            ordinal: 1,
            version: 2,
            schema_version: 1,
            lifecycle: "streaming",
            kind: "reasoning",
            payload: { safe_summary: "drifted identity" },
          },
        },
      }),
    })

    expect(store.getSnapshot().messages[1]?.parts[0]).toMatchObject({ kind: "text", text: "hi", ordinal: 0, version: 1 })
    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "part_identity_conflict" })

    const messageDriftStore = createChatProjectionStore()
    messageDriftStore.dispatch({ type: "snapshot", snapshot: snapshot() })
    messageDriftStore.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            part_id: "part-assistant-12345678",
            message_id: "message-user-12345678",
            ordinal: 0,
            version: 2,
            schema_version: 1,
            lifecycle: "completed",
            kind: "text",
            payload: { spans: [{ text: "moved message" }] },
          },
        },
      }),
    })

    expect(messageDriftStore.getSnapshot().messages[0]?.parts).toHaveLength(1)
    expect(messageDriftStore.getSnapshot().messages[1]?.parts[0]).toMatchObject({ text: "hi", version: 1 })
    expect(messageDriftStore.getSnapshot().repair).toEqual({ required: true, reason: "part_identity_conflict" })
  })

  it("treats an exact part replay as a no-op", () => {
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: snapshot() })
    const listener = vi.fn()
    store.subscribe(listener)
    const update = event({
      kind: "message.part.updated",
      payload: {
        part: {
          part_id: "part-assistant-12345678",
          message_id: "message-assistant-12345678",
          ordinal: 0,
          version: 2,
          schema_version: 1,
          lifecycle: "completed",
          kind: "text",
          payload: { spans: [{ text: "hi there" }] },
        },
      },
    })

    store.dispatch({ type: "event", event: update })
    const afterUpdate = store.getSnapshot()
    store.dispatch({ type: "event", event: update })

    expect(store.getSnapshot()).toBe(afterUpdate)
    expect(listener).toHaveBeenCalledOnce()
  })

  it("fails closed and requests a snapshot when the active branch changes", () => {
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: snapshot() })
    store.dispatch({
      type: "event",
      event: event({
        kind: "branch.activated",
        payload: { branch_id: "branch-other-12345678", session_version: 3 },
      }),
    })

    expect(store.getSnapshot()).toMatchObject({
      messages: [],
      activeRunId: null,
      repair: { required: true, reason: "active_branch_changed_refetch_snapshot" },
    })
  })

  it("preserves and renders every authoritative v3 card payload including HITL routing identity", () => {
    const base = snapshot()
    const assistant = base.messages[1]
    if (assistant === undefined) throw new Error("assistant fixture missing")
    const rich: SessionSnapshot = {
      ...base,
      messages: [base.messages[0] as SessionSnapshot["messages"][number], {
        ...assistant,
        parts: [
          { part_id: "citation-1", message_id: assistant.message_id, ordinal: 0, version: 1, schema_version: 1, lifecycle: "completed", kind: "citation", payload: { source_ref: "source-1", title: "Source", locator: "p. 2", attribution: "Author" } },
          { part_id: "approval-1", message_id: assistant.message_id, ordinal: 1, version: 3, schema_version: 1, lifecycle: "streaming", kind: "approval", payload: { owner_ref: "owner-approval", expected_version: 7, decision_group_ref: "decision-group-1", required_owner_refs: ["owner-approval"], title: "Approve effect", description: "Allow the effect", deadline: NOW, allowed_actions: ["approve", "reject"], receipt_ref: "receipt-1", status: "pending" } },
          { part_id: "interaction-1", message_id: assistant.message_id, ordinal: 2, version: 2, schema_version: 1, lifecycle: "streaming", kind: "interaction", payload: { owner_ref: "owner-interaction", expected_version: 4, decision_group_ref: "decision-group-2", required_owner_refs: ["owner-interaction"], title: "Input", description: "Provide input", allowed_actions: ["respond"], status: "pending" } },
          { part_id: "plan-1", message_id: assistant.message_id, ordinal: 3, version: 1, schema_version: 1, lifecycle: "completed", kind: "plan", payload: { plan_proposal_ref: "plan-ref", plan_version: 1, summary: "Inspect first", steps: [{ step_ref: "step-1", label: "Inspect", status: "done" }], allowed_actions: ["accept", "reject"], status: "pending" } },
          { part_id: "job-1", message_id: assistant.message_id, ordinal: 4, version: 1, schema_version: 1, lifecycle: "streaming", kind: "job", payload: { owner_ref: "job-owner", status: "running", safe_metadata: { label: "Render" } } },
          { part_id: "artifact-1", message_id: assistant.message_id, ordinal: 5, version: 1, schema_version: 1, lifecycle: "completed", kind: "artifact", payload: { owner_ref: "artifact-owner", status: "ready", safe_metadata: { media_type: "image/png" } } },
          { part_id: "cost-1", message_id: assistant.message_id, ordinal: 6, version: 1, schema_version: 1, lifecycle: "completed", kind: "cost", payload: { cost_projection_ref: "cost-ref", status: "settled", amount: "1.25", currency_or_credit_unit: "credits", freshness: NOW } },
          { part_id: "notice-1", message_id: assistant.message_id, ordinal: 7, version: 1, schema_version: 1, lifecycle: "completed", kind: "notice", payload: { code: "WAIT", message: "Still working", retry_class: "after_delay", support_correlation_ref: "support-1" } },
          { part_id: "error-1", message_id: assistant.message_id, ordinal: 8, version: 1, schema_version: 1, lifecycle: "failed", kind: "error", payload: { code: "FAILED", message: "Stopped", retry_class: "never" } },
        ],
      }],
    }
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: rich })
    const assistantProjection = store.getSnapshot().messages[1]
    if (assistantProjection === undefined) throw new Error("assistant projection missing")

    expect(assistantProjection.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "citation", sourceRef: "source-1", locator: "p. 2", version: 1, ordinal: 0 }),
      expect.objectContaining({ kind: "approval", ownerRef: "owner-approval", expectedVersion: 7, allowedActions: ["approve", "reject"], receiptRef: "receipt-1", version: 3, ordinal: 1 }),
      expect.objectContaining({ kind: "interaction", ownerRef: "owner-interaction", expectedVersion: 4, allowedActions: ["respond"] }),
      expect.objectContaining({ kind: "plan", planProposalRef: "plan-ref" }),
      expect.objectContaining({ kind: "job", ownerRef: "job-owner", safeMetadata: { label: "Render" } }),
      expect.objectContaining({ kind: "artifact", ownerRef: "artifact-owner" }),
      expect.objectContaining({ kind: "cost", costProjectionRef: "cost-ref", amount: "1.25" }),
      expect.objectContaining({ kind: "notice", code: "WAIT", retryClass: "after_delay" }),
      expect.objectContaining({ kind: "error", code: "FAILED", retryClass: "never" }),
    ]))

    const adapter = createKokoroExternalStoreAdapter(store.getSnapshot(), { submit: async () => undefined })
    const rendered = adapter.convertMessage(assistantProjection, 1)
    expect(rendered.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "data", name: "kokoro:approval", data: expect.objectContaining({ ownerRef: "owner-approval", expectedVersion: 7 }) }),
      expect.objectContaining({ type: "data", name: "kokoro:citation", data: expect.objectContaining({ sourceRef: "source-1" }) }),
      expect.objectContaining({ type: "data", name: "kokoro:cost", data: expect.objectContaining({ costProjectionRef: "cost-ref" }) }),
    ]))
  })

  it("rejects part version regression without mutating the current projection", () => {
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: snapshot() })
    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            part_id: "part-assistant-12345678",
            message_id: "message-assistant-12345678",
            ordinal: 0,
            version: 2,
            schema_version: 1,
            lifecycle: "streaming",
            kind: "text",
            payload: { spans: [{ text: "fresh" }] },
          },
        },
      }),
    })
    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            part_id: "part-assistant-12345678",
            message_id: "message-assistant-12345678",
            ordinal: 0,
            version: 1,
            schema_version: 1,
            lifecycle: "completed",
            kind: "text",
            payload: { spans: [{ text: "stale" }] },
          },
        },
      }),
    })

    expect(store.getSnapshot().messages[1]?.parts[0]).toMatchObject({ text: "fresh", version: 2, ordinal: 0 })
    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "part_version_regression" })
  })

  it("uses launch, run, and control projections to own active and cancelling state", () => {
    const base = snapshot()
    const launching: SessionSnapshot = {
      ...base,
      runs: [],
      run_launches: [{
        launch_id: "launch-12345678",
        branch_id: base.session.active_branch_id,
        trigger_message_id: "message-user-12345678",
        proposed_run_id: "run-12345678",
        status: "dispatch_pending",
        command_receipt_ref: "receipt-launch",
        version: 2,
        updated_at: NOW,
      }],
      controls: [{
        decision_id: "decision-12345678",
        run_id: "run-12345678",
        kind: "cancel",
        status: "persisted",
        command_receipt_ref: "receipt-control",
        updated_at: NOW,
      }],
    }
    const store = createChatProjectionStore()
    store.dispatch({ type: "snapshot", snapshot: launching })
    expect(store.getSnapshot()).toMatchObject({ activeRunId: "run-12345678", activeRunState: "cancelling" })

    store.dispatch({
      type: "event",
      event: event({
        kind: "run.launch.updated",
        payload: { launch: { ...launching.run_launches[0] as NonNullable<typeof launching.run_launches[0]>, status: "failed", failure_code: "ADMISSION_DENIED", version: 3 } },
      }),
    })
    expect(store.getSnapshot()).toMatchObject({ activeRunId: null, activeRunState: null })
  })
})
