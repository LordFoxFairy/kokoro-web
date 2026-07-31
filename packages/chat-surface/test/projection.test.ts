import type { MessagePartEnvelope, SessionEvent, SessionSnapshot } from "@kokoro/session-client/contracts"
import { describe, expect, it, vi } from "vitest"

import * as ChatProjectionModule from "../src/projection/store.js"
import {
  createChatProjection,
  createChatProjectionStore,
  type ChatPart,
  type ChatProjection,
} from "../src/projection/store.js"
import { createKokoroExternalStoreAdapter } from "../src/runtime/kokoro-external-store-adapter.js"

const NOW = "2026-07-28T00:00:00.000Z"

type Exact<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false
type ContractPayload<Kind extends MessagePartEnvelope["kind"]> =
  Extract<MessagePartEnvelope, { readonly kind: Kind }>["payload"]
type ProjectedPart<Kind extends ChatPart["kind"]> = Extract<ChatPart, { readonly kind: Kind }>

const EXACT_ENUM_TYPES: readonly [
  Exact<ProjectedPart<"subagent">["status"], ContractPayload<"subagent">["status"]>,
  Exact<ProjectedPart<"media-operation">["state"], ContractPayload<"media-operation">["state"]>,
  Exact<ProjectedPart<"artifact">["availability"], ContractPayload<"artifact">["availability"]>,
  Exact<ProjectedPart<"cost">["state"], ContractPayload<"cost">["state"]>,
  Exact<ProjectedPart<"cost">["freshness"], ContractPayload<"cost">["freshness"]>,
  Exact<ProjectedPart<"notice">["severity"], ContractPayload<"notice">["severity"]>,
  Exact<ProjectedPart<"notice">["retryClass"], ContractPayload<"notice">["retry_class"]>,
  Exact<ProjectedPart<"error">["retryClass"], ContractPayload<"error">["retry_class"]>,
] = [true, true, true, true, true, true, true, true]

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

function snapshotWithAssistantParts(parts: readonly MessagePartEnvelope[]): SessionSnapshot {
  const base = snapshot()
  const assistant = base.messages[1]
  if (assistant === undefined) throw new Error("assistant fixture missing")
  return {
    ...base,
    messages: [base.messages[0] as SessionSnapshot["messages"][number], { ...assistant, parts: [...parts] }],
  }
}

describe("Chat projection", () => {
  it("keeps generated enum fields exact instead of widening them to string", () => {
    expect(EXACT_ENUM_TYPES).toEqual([true, true, true, true, true, true, true, true])
  })

  it("keeps reducer ownership inside a store and rejects cloned projection initial state", () => {
    expect("reduceChatProjection" in ChatProjectionModule).toBe(false)

    const structuredCloneProjection = structuredClone(createChatProjection())
    const jsonCloneProjection = JSON.parse(JSON.stringify(createChatProjection())) as ChatProjection
    expect(structuredCloneProjection).toEqual(createChatProjection())
    expect(jsonCloneProjection).toEqual(createChatProjection())

    const assertInvalidInputs = (): void => {
      // @ts-expect-error Public projection views are not valid store initial state.
      createChatProjectionStore(structuredCloneProjection)
      // @ts-expect-error JSON-cloned projection views are not valid store initial state.
      createChatProjectionStore(jsonCloneProjection)
      const store = createChatProjectionStore()
      // @ts-expect-error Authoritative snapshots use hydrate, not the mutation channel.
      store.dispatch({ type: "snapshot", snapshot: snapshot() })
    }
    expect(assertInvalidInputs).toBeTypeOf("function")
  })

  it("hydrates JSON-roundtripped authoritative snapshots without false replay conflicts", () => {
    const store = createChatProjectionStore()

    store.hydrate(JSON.parse(JSON.stringify(snapshot())) as SessionSnapshot)
    const beforeReplay = store.getSnapshot()
    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: snapshot().messages[1]!.parts[0]!,
        },
      }),
    })

    expect(store.getSnapshot()).toBe(beforeReplay)

    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            ...snapshot().messages[1]!.parts[0]!,
            payload: { part_ref: "drifted-part-ref", spans: [{ text: "hi" }] },
          },
        },
      }),
    })

    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "part_version_conflict" })
  })

  it("rehydrates the active v3 message lineage and active run without legacy repair", () => {
    const store = createChatProjectionStore()

    store.hydrate(snapshot())

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
    store.hydrate(snapshot())
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

  it("locates a 1000-message tail update without scanning the message collection", () => {
    const base = snapshot()
    const messages: SessionSnapshot["messages"] = Array.from({ length: 1_000 }, (_, index) => {
      const messageId = `message-${String(index).padStart(8, "0")}`
      const parentMessageId = index === 0 ? undefined : `message-${String(index - 1).padStart(8, "0")}`
      return {
        message_id: messageId,
        branch_id: base.session.active_branch_id,
        ...(parentMessageId === undefined ? {} : { parent_message_id: parentMessageId }),
        role: index % 2 === 0 ? "user" as const : "assistant" as const,
        ordinal: index,
        lifecycle: index === 999 ? "streaming" as const : "completed" as const,
        parts: [{
          part_id: `part-${String(index).padStart(8, "0")}`,
          message_id: messageId,
          ordinal: 0,
          version: 1,
          schema_version: 1,
          lifecycle: index === 999 ? "streaming" as const : "completed" as const,
          kind: "text" as const,
          payload: { spans: [{ text: `message ${index}` }] },
        }],
        attachments: [],
        created_at: NOW,
      }
    })
    const tail = messages.at(-1)
    if (tail === undefined) throw new Error("tail fixture missing")
    const longSnapshot: SessionSnapshot = {
      ...base,
      session: { ...base.session, active_leaf_message_id: tail.message_id },
      messages,
    }
    const update = event({
      kind: "message.part.updated",
      payload: { part: { ...tail.parts[0]!, version: 2, payload: { spans: [{ text: "streamed tail" }] } } },
    })
    const store = createChatProjectionStore()
    store.hydrate(longSnapshot)
    const find = vi.spyOn(Array.prototype, "find")
    const findIndex = vi.spyOn(Array.prototype, "findIndex")
    let messageFindCalls: number
    let findIndexCalls: number
    try {
      store.dispatch({ type: "event", event: update })
      messageFindCalls = find.mock.calls.length
      findIndexCalls = findIndex.mock.calls.length
    } finally {
      find.mockRestore()
      findIndex.mockRestore()
    }
    expect(messageFindCalls).toBe(0)
    expect(findIndexCalls).toBe(1)
    expect(store.getSnapshot().messages.at(-1)?.parts[0]).toMatchObject({ version: 2, text: "streamed tail" })
  })

  it("requests snapshot repair without applying a part version gap", () => {
    const store = createChatProjectionStore()
    store.hydrate(snapshot())
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
    unseenPartStore.hydrate(snapshot())
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
    store.hydrate(snapshot())
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
            kind: "reasoning-summary",
            payload: { part_ref: "reasoning-drift", safe_summary: "drifted identity" },
          },
        },
      }),
    })

    expect(store.getSnapshot().messages[1]?.parts[0]).toMatchObject({ kind: "text", text: "hi", ordinal: 0, version: 1 })
    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "part_identity_conflict" })

    const messageDriftStore = createChatProjectionStore()
    messageDriftStore.hydrate(snapshot())
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
    store.hydrate(snapshot())
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

  it("rejects same-version envelopes that only become equal after lossy projection", () => {
    const base = snapshot()
    const assistant = base.messages[1]
    if (assistant === undefined) throw new Error("assistant fixture missing")
    const textBase = {
      part_id: "lossy-text",
      message_id: assistant.message_id,
      ordinal: 0,
      version: 1,
      schema_version: 1 as const,
      lifecycle: "streaming" as const,
      kind: "text" as const,
    }
    const toolBase = {
      part_id: "lossy-tool",
      message_id: assistant.message_id,
      ordinal: 0,
      version: 1,
      schema_version: 1 as const,
      lifecycle: "streaming" as const,
      kind: "tool-call" as const,
    }
    const cases: readonly Readonly<{
      label: string
      initial: MessagePartEnvelope
      replay: MessagePartEnvelope
    }>[] = [
      {
        label: "text part_ref",
        initial: { ...textBase, payload: { part_ref: "text-ref-a", spans: [{ text: "hi" }] } },
        replay: { ...textBase, payload: { part_ref: "text-ref-b", spans: [{ text: "hi" }] } },
      },
      {
        label: "text span boundaries",
        initial: { ...textBase, payload: { part_ref: "text-ref", spans: [{ text: "h" }, { text: "i" }] } },
        replay: { ...textBase, payload: { part_ref: "text-ref", spans: [{ text: "hi" }] } },
      },
      {
        label: "raw tool status",
        initial: { ...toolBase, payload: { tool_call_id: "tool-call-1", tool_label: "Search", status: "queued" } },
        replay: { ...toolBase, payload: { tool_call_id: "tool-call-1", tool_label: "Search", status: "started" } },
      },
    ]

    for (const candidate of cases) {
      const store = createChatProjectionStore()
      store.hydrate({
        ...base,
        messages: [base.messages[0] as SessionSnapshot["messages"][number], { ...assistant, parts: [candidate.initial] }],
      })
      const before = store.getSnapshot().messages[1]?.parts
      store.dispatch({
        type: "event",
        event: event({ kind: "message.part.updated", payload: { part: candidate.replay } }),
      })

      expect(store.getSnapshot().repair, candidate.label).toEqual({ required: true, reason: "part_version_conflict" })
      expect(store.getSnapshot().messages[1]?.parts, candidate.label).toBe(before)
      if (candidate.label === "text part_ref") {
        expect(JSON.stringify(store.getSnapshot())).not.toContain("text-ref-a")
        const projected = store.getSnapshot().messages[1]
        if (projected === undefined) throw new Error("assistant projection missing")
        const rendered = createKokoroExternalStoreAdapter(store.getSnapshot(), { submit: async () => undefined })
          .convertMessage(projected, 1)
        expect(JSON.stringify(rendered)).not.toContain("text-ref-a")
      }
    }
  })

  it("treats object key order as semantically irrelevant while preserving array order", () => {
    const base = snapshot()
    const assistant = base.messages[1]
    if (assistant === undefined) throw new Error("assistant fixture missing")
    const initial: MessagePartEnvelope = {
      part_id: "tool-key-order",
      message_id: assistant.message_id,
      ordinal: 0,
      version: 1,
      schema_version: 1,
      lifecycle: "streaming",
      kind: "tool-call",
      payload: {
        tool_call_id: "tool-call-key-order",
        tool_label: "Search",
        input_summary: { query: "fox", options: { safe: true, locale: "en" }, order: ["recent", "relevant"] },
        status: "started",
      },
    }
    const replay: MessagePartEnvelope = {
      ...initial,
      payload: {
        status: "started",
        input_summary: { ignored_by_json_wire: undefined, order: ["recent", "relevant"], options: { locale: "en", safe: true }, query: "fox" },
        tool_label: "Search",
        tool_call_id: "tool-call-key-order",
      },
    }
    const store = createChatProjectionStore()
    store.hydrate({
      ...base,
      messages: [base.messages[0] as SessionSnapshot["messages"][number], { ...assistant, parts: [initial] }],
    })
    const before = store.getSnapshot()
    store.dispatch({ type: "event", event: event({ kind: "message.part.updated", payload: { part: replay } }) })

    expect(store.getSnapshot()).toBe(before)
    expect(store.getSnapshot().repair).toEqual({ required: false })

    store.dispatch({
      type: "event",
      event: event({
        kind: "message.part.updated",
        payload: {
          part: {
            ...replay,
            payload: {
              ...replay.payload,
              input_summary: { query: "fox", options: { safe: true, locale: "en" }, order: ["relevant", "recent"] },
            },
          },
        },
      }),
    })
    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "part_version_conflict" })
  })

  it("fails closed and requests a snapshot when the active branch changes", () => {
    const store = createChatProjectionStore()
    store.hydrate(snapshot())
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

  it("projects every authoritative typed part and preserves HITL routing identity", () => {
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
          { part_id: "reasoning-1", message_id: assistant.message_id, ordinal: 4, version: 1, schema_version: 1, lifecycle: "completed", kind: "reasoning-summary", payload: { part_ref: "reasoning-ref", safe_summary: "Compared safe alternatives" } },
          { part_id: "tool-1", message_id: assistant.message_id, ordinal: 5, version: 1, schema_version: 1, lifecycle: "streaming", kind: "tool-call", payload: { tool_call_id: "Tool/Call:Exact-01", tool_label: "Search", status: "started" } },
          { part_id: "plan-progress-1", message_id: assistant.message_id, ordinal: 6, version: 1, schema_version: 1, lifecycle: "streaming", kind: "plan-progress", payload: { plan_ref: "plan-progress-ref", safe_summary: "Building the result", steps: [{ step_ref: "step-progress-1", label: "Render", status: "in_progress" }] } },
          { part_id: "subagent-1", message_id: assistant.message_id, ordinal: 7, version: 1, schema_version: 1, lifecycle: "streaming", kind: "subagent", payload: { subagent_ref: "subagent-ref", status: "running", safe_summary: "Checking references" } },
          { part_id: "media-1", message_id: assistant.message_id, ordinal: 8, version: 1, schema_version: 1, lifecycle: "streaming", kind: "media-operation", payload: { media_operation_ref: "media-ref", definition_ref: "image.text_to_image", definition_revision_ref: "image.text_to_image@1", owner_version: "7", progress_bps: 3750, candidates: [{ candidate_ref: "candidate-ready", ordinal: 0, owner_version: "5", artifact_ref: "artifact-ref", artifact_version_ref: "artifact-v1", state: "ready" }, { candidate_ref: "candidate-unknown", ordinal: 1, owner_version: "3", state: "unknown" }, { candidate_ref: "candidate-restricted", ordinal: 2, owner_version: "4", state: "restricted", safe_failure: { code: "artifact_restricted", retry_class: "never", safe_message: "Not available for delivery." } }], cost_projection: { cost_projection_ref: "cost-ref", owner_version: "2" }, updated_at: NOW, state: "active" } },
          { part_id: "artifact-1", message_id: assistant.message_id, ordinal: 9, version: 1, schema_version: 1, lifecycle: "completed", kind: "artifact", payload: { artifact_ref: "artifact-ref", artifact_version_ref: "artifact-v1", owner_version: "11", media_class: "image", updated_at: NOW, availability: "ready", payload: { format: "png", width: 1024, height: 768, byte_size: "245760" } } },
          { part_id: "cost-1", message_id: assistant.message_id, ordinal: 10, version: 1, schema_version: 1, lifecycle: "completed", kind: "cost", payload: { media_operation_ref: "media-ref", cost_projection_ref: "cost-ref", owner_version: "13", freshness: "stale", updated_at: NOW, corrects_owner_version: "12", state: "corrected", payload: { amount: "125", credit_unit: "credits" } } },
          { part_id: "notice-1", message_id: assistant.message_id, ordinal: 11, version: 1, schema_version: 1, lifecycle: "completed", kind: "notice", payload: { notice_ref: "notice-ref", code: "WAIT", message: "Still working", severity: "warning", support_correlation_ref: "support-1" } },
          { part_id: "error-1", message_id: assistant.message_id, ordinal: 12, version: 1, schema_version: 1, lifecycle: "failed", kind: "error", payload: { error_ref: "error-ref", code: "FAILED", message: "Stopped", retry_class: "never" } },
          { part_id: "unsupported-1", message_id: assistant.message_id, ordinal: 13, version: 1, schema_version: 1, lifecycle: "unsupported", kind: "unsupported", payload: { original_kind: "future-visual", original_schema_version: 2, safe_fallback: "A newer client can render this content." } },
        ],
      }],
    }
    const store = createChatProjectionStore()
    store.hydrate(rich)
    const assistantProjection = store.getSnapshot().messages[1]
    if (assistantProjection === undefined) throw new Error("assistant projection missing")

    expect(assistantProjection.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "citation", sourceRef: "source-1", locator: "p. 2", version: 1, ordinal: 0 }),
      expect.objectContaining({ kind: "approval", ownerRef: "owner-approval", expectedVersion: 7, allowedActions: ["approve", "reject"], receiptRef: "receipt-1", version: 3, ordinal: 1 }),
      expect.objectContaining({ kind: "interaction", ownerRef: "owner-interaction", expectedVersion: 4, allowedActions: ["respond"] }),
      expect.objectContaining({ kind: "plan", planProposalRef: "plan-ref" }),
      expect.objectContaining({ kind: "reasoning-summary", partRef: "reasoning-ref", text: "Compared safe alternatives" }),
      expect.objectContaining({ kind: "tool", toolCallId: "Tool/Call:Exact-01", args: {} }),
      expect.objectContaining({ kind: "plan-progress", planRef: "plan-progress-ref", summary: "Building the result" }),
      expect.objectContaining({ kind: "subagent", subagentRef: "subagent-ref", status: "running" }),
      expect.objectContaining({ kind: "media-operation", mediaOperationRef: "media-ref", definitionRef: "image.text_to_image", definitionRevisionRef: "image.text_to_image@1", ownerVersion: "7", state: "active", progressBps: 3750, candidates: [expect.objectContaining({ state: "ready", artifactVersionRef: "artifact-v1" }), expect.objectContaining({ state: "unknown" }), expect.objectContaining({ state: "restricted", failure: { code: "artifact_restricted", retryClass: "never", safeMessage: "Not available for delivery." } })], costProjection: { costProjectionRef: "cost-ref", ownerVersion: "2" } }),
      expect.objectContaining({ kind: "artifact", artifactRef: "artifact-ref", artifactVersionRef: "artifact-v1", ownerVersion: "11", mediaClass: "image", availability: "ready", display: { format: "png", width: 1024, height: 768, byteSize: "245760" } }),
      expect.objectContaining({ kind: "cost", mediaOperationRef: "media-ref", costProjectionRef: "cost-ref", ownerVersion: "13", state: "corrected", freshness: "stale", correctsOwnerVersion: "12", amount: { amount: "125", creditUnit: "credits" } }),
      expect.objectContaining({ kind: "notice", noticeRef: "notice-ref", code: "WAIT", severity: "warning" }),
      expect.objectContaining({ kind: "error", errorRef: "error-ref", code: "FAILED", retryClass: "never" }),
      expect.objectContaining({ kind: "unsupported", originalKind: "future-visual", safeFallback: "A newer client can render this content." }),
    ]))

    const adapter = createKokoroExternalStoreAdapter(store.getSnapshot(), { submit: async () => undefined })
    const rendered = adapter.convertMessage(assistantProjection, 1)
    expect(rendered.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "data", name: "kokoro:approval", data: expect.objectContaining({ ownerRef: "owner-approval", expectedVersion: 7 }) }),
      expect.objectContaining({ type: "data", name: "kokoro:citation", data: expect.objectContaining({ sourceRef: "source-1" }) }),
      expect.objectContaining({ type: "tool-call", toolCallId: "Tool/Call:Exact-01", args: {} }),
      expect.objectContaining({ type: "data", name: "kokoro:plan-progress", data: expect.objectContaining({ planRef: "plan-progress-ref" }) }),
      expect.objectContaining({ type: "data", name: "kokoro:subagent", data: expect.objectContaining({ subagentRef: "subagent-ref" }) }),
      expect.objectContaining({ type: "data", name: "kokoro:media-operation", data: expect.objectContaining({ mediaOperationRef: "media-ref", definitionRevisionRef: "image.text_to_image@1", ownerVersion: "7", state: "active", progressBps: 3750, candidates: expect.arrayContaining([expect.objectContaining({ candidateRef: "candidate-unknown", state: "unknown" })]) }) }),
      expect.objectContaining({ type: "data", name: "kokoro:artifact", data: expect.objectContaining({ artifactRef: "artifact-ref", artifactVersionRef: "artifact-v1", availability: "ready", display: { format: "png", width: 1024, height: 768, byteSize: "245760" } }) }),
      expect.objectContaining({ type: "data", name: "kokoro:cost", data: expect.objectContaining({ costProjectionRef: "cost-ref", state: "corrected", freshness: "stale", amount: { amount: "125", creditUnit: "credits" } }) }),
      expect.objectContaining({ type: "data", name: "kokoro:unsupported", data: expect.objectContaining({ originalKind: "future-visual" }) }),
    ]))
    expect(assistantProjection.parts).toHaveLength(14)
  })

  it("preserves authoritative tool results and emits typed result metadata without collapsing false or absent", () => {
    const base = snapshot()
    const assistant = base.messages[1]
    if (assistant === undefined) throw new Error("assistant fixture missing")
    const rich: SessionSnapshot = {
      ...base,
      messages: [base.messages[0] as SessionSnapshot["messages"][number], {
        ...assistant,
        parts: [
          { part_id: "tool-false", message_id: assistant.message_id, ordinal: 0, version: 1, schema_version: 1, lifecycle: "completed", kind: "tool-call", payload: { tool_call_id: "tool-call-false", tool_label: "Search", status: "completed", safe_result_preview: "No matches", is_error: false, truncated: true } },
          { part_id: "tool-true", message_id: assistant.message_id, ordinal: 1, version: 1, schema_version: 1, lifecycle: "completed", kind: "tool-call", payload: { tool_call_id: "tool-call-true", tool_label: "Fetch", status: "completed", safe_result_preview: "Permission denied", is_error: true } },
          { part_id: "tool-absent", message_id: assistant.message_id, ordinal: 2, version: 1, schema_version: 1, lifecycle: "completed", kind: "tool-call", payload: { tool_call_id: "tool-call-absent", tool_label: "Inspect", status: "completed", safe_result_preview: "Complete" } },
        ],
      }],
    }
    const store = createChatProjectionStore()
    store.hydrate(rich)
    const projected = store.getSnapshot().messages[1]
    if (projected === undefined) throw new Error("assistant projection missing")

    expect(projected.parts).toEqual([
      expect.objectContaining({ kind: "tool", toolCallId: "tool-call-false", result: "No matches", isError: false, truncated: true }),
      expect.objectContaining({ kind: "tool", toolCallId: "tool-call-true", result: "Permission denied", isError: true }),
      expect.objectContaining({ kind: "tool", toolCallId: "tool-call-absent", result: "Complete" }),
    ])
    expect(projected.parts[2]).not.toHaveProperty("isError")

    const rendered = createKokoroExternalStoreAdapter(store.getSnapshot(), { submit: async () => undefined })
      .convertMessage(projected, 1)
    expect(rendered.content).toEqual([
      expect.objectContaining({ type: "tool-call", toolCallId: "tool-call-false", result: "No matches", isError: false }),
      expect.objectContaining({ type: "data", name: "kokoro:tool-result-metadata", data: expect.objectContaining({ toolCallId: "tool-call-false", truncated: true, isError: false, ordinal: 0, version: 1, lifecycle: "completed" }) }),
      expect.objectContaining({ type: "tool-call", toolCallId: "tool-call-true", result: "Permission denied", isError: true }),
      expect.objectContaining({ type: "data", name: "kokoro:tool-result-metadata", data: expect.objectContaining({ toolCallId: "tool-call-true", isError: true, ordinal: 1, version: 1, lifecycle: "completed" }) }),
      expect.objectContaining({ type: "tool-call", toolCallId: "tool-call-absent", result: "Complete" }),
      expect.objectContaining({ type: "data", name: "kokoro:tool-result-metadata", data: expect.not.objectContaining({ isError: expect.anything() }) }),
    ])
    expect(rendered.content[4]).not.toHaveProperty("isError")
    expect(rendered.content[5]).not.toHaveProperty("data.isError")
  })

  it("converges snapshot and SSE media-operation updates through the same versioned reducer", () => {
    const base = snapshot()
    const assistant = base.messages[1]
    if (assistant === undefined) throw new Error("assistant fixture missing")
    const first = {
      part_id: "media-1",
      message_id: assistant.message_id,
      ordinal: 0,
      version: 1,
      schema_version: 1 as const,
      lifecycle: "streaming" as const,
      kind: "media-operation" as const,
      payload: {
        media_operation_ref: "media-ref",
        definition_ref: "image.text_to_image",
        definition_revision_ref: "image.text_to_image@1",
        owner_version: "1",
        progress_bps: 2500,
        candidates: [{ candidate_ref: "candidate-1", ordinal: 0, owner_version: "1", state: "producing" as const }],
        updated_at: NOW,
        state: "active" as const,
      },
    }
    const second = {
      ...first,
      version: 2,
      payload: {
        ...first.payload,
        owner_version: "2",
        progress_bps: 10000,
        candidates: [{ candidate_ref: "candidate-1", ordinal: 0, owner_version: "2", artifact_ref: "artifact-ref", artifact_version_ref: "artifact-v1", state: "ready" as const }],
        outcome_class: "canonical" as const,
        state: "completed" as const,
      },
      lifecycle: "completed" as const,
    }
    const withPart = (part: typeof first | typeof second): SessionSnapshot => ({
      ...base,
      messages: [base.messages[0] as SessionSnapshot["messages"][number], { ...assistant, parts: [part] }],
    })

    const streamed = createChatProjectionStore()
    streamed.hydrate(withPart(first))
    streamed.dispatch({ type: "event", event: event({
      kind: "message.part.updated",
      payload: { part: second },
    }) })
    const hydrated = createChatProjectionStore()
    hydrated.hydrate(withPart(second))

    expect(streamed.getSnapshot().messages[1]?.parts).toEqual(hydrated.getSnapshot().messages[1]?.parts)
    expect(streamed.getSnapshot().messages[1]?.parts[0]).toMatchObject({
      kind: "media-operation",
      version: 2,
      progressBps: 10000,
      ownerVersion: "2",
      state: "completed",
      outcomeClass: "canonical",
      candidates: [expect.objectContaining({ state: "ready", artifactRef: "artifact-ref", artifactVersionRef: "artifact-v1" })],
    })
  })

  it("deep-freezes copied owner state so caller mutations cannot bypass the store", () => {
    const part: MessagePartEnvelope = {
      part_id: "media-frozen",
      message_id: "message-assistant-12345678",
      ordinal: 0,
      version: 1,
      schema_version: 1,
      lifecycle: "streaming",
      kind: "media-operation",
      payload: {
        media_operation_ref: "media-ref",
        definition_ref: "image.text_to_image",
        definition_revision_ref: "image.text_to_image@1",
        owner_version: "8",
        progress_bps: 4200,
        candidates: [{
          candidate_ref: "candidate-restricted",
          ordinal: 0,
          owner_version: "3",
          safe_failure: { code: "artifact_restricted", retry_class: "never", safe_message: "Restricted by policy." },
          state: "restricted",
        }],
        cost_projection: { cost_projection_ref: "cost-ref", owner_version: "2" },
        updated_at: NOW,
        state: "active",
      },
    }
    const input = snapshotWithAssistantParts([part])
    const store = createChatProjectionStore()
    store.hydrate(input)
    const projection = store.getSnapshot()
    const projected = projection.messages[1]?.parts[0]
    if (projected?.kind !== "media-operation") throw new Error("media projection missing")

    expect(Object.isFrozen(projection)).toBe(true)
    expect(Object.isFrozen(projection.messages)).toBe(true)
    expect(Object.isFrozen(projected)).toBe(true)
    expect(Object.isFrozen(projected.candidates)).toBe(true)
    expect(Object.isFrozen(projected.candidates[0])).toBe(true)
    expect(Object.isFrozen(projected.candidates[0]?.state === "restricted" ? projected.candidates[0].failure : null)).toBe(true)
    expect(Object.isFrozen(projected.costProjection)).toBe(true)

    const inputPart = input.messages[1]?.parts[0]
    if (inputPart?.kind !== "media-operation") throw new Error("input media part missing")
    const inputCandidate = inputPart.payload.candidates[0]
    if (inputCandidate === undefined) throw new Error("input candidate missing")
    ;(inputCandidate as { state: string }).state = "ready"
    expect(projected.candidates[0]).toMatchObject({ state: "restricted", failure: { code: "artifact_restricted" } })
  })

  it("rejects Media owner and candidate version regressions without replacing authoritative state", () => {
    const current: MessagePartEnvelope = {
      part_id: "media-monotonic",
      message_id: "message-assistant-12345678",
      ordinal: 0,
      version: 1,
      schema_version: 1,
      lifecycle: "streaming",
      kind: "media-operation",
      payload: {
        media_operation_ref: "media-ref",
        definition_ref: "image.text_to_image",
        definition_revision_ref: "image.text_to_image@1",
        owner_version: "8",
        progress_bps: 5000,
        candidates: [{ candidate_ref: "candidate-1", ordinal: 0, owner_version: "5", state: "validating" }],
        updated_at: NOW,
        state: "finalizing",
      },
    }
    const ownerRegression: MessagePartEnvelope = {
      ...current,
      version: 2,
      payload: { ...current.payload, owner_version: "7", progress_bps: 6000 },
    }
    const ownerStore = createChatProjectionStore()
    ownerStore.hydrate(snapshotWithAssistantParts([current]))
    ownerStore.dispatch({ type: "event", event: event({ kind: "message.part.updated", payload: { part: ownerRegression } }) })
    expect(ownerStore.getSnapshot().messages[1]?.parts[0]).toMatchObject({ ownerVersion: "8", progressBps: 5000 })
    expect(ownerStore.getSnapshot().repair).toEqual({ required: true, reason: "owner_version_regression" })

    const candidateRegression: MessagePartEnvelope = {
      ...current,
      version: 2,
      payload: {
        ...current.payload,
        owner_version: "9",
        progress_bps: 6000,
        candidates: [{ candidate_ref: "candidate-1", ordinal: 0, owner_version: "4", state: "validating" }],
      },
    }
    const candidateStore = createChatProjectionStore()
    candidateStore.hydrate(snapshotWithAssistantParts([current]))
    candidateStore.dispatch({ type: "event", event: event({ kind: "message.part.updated", payload: { part: candidateRegression } }) })
    expect(candidateStore.getSnapshot().messages[1]?.parts[0]).toMatchObject({ ownerVersion: "8", candidates: [expect.objectContaining({ ownerVersion: "5" })] })
    expect(candidateStore.getSnapshot().repair).toEqual({ required: true, reason: "candidate_owner_version_regression" })
  })

  it("keeps Media terminal state closed and preserves owner failure and unavailable projections", () => {
    const terminal: MessagePartEnvelope = {
      part_id: "media-terminal",
      message_id: "message-assistant-12345678",
      ordinal: 0,
      version: 1,
      schema_version: 1,
      lifecycle: "failed",
      kind: "media-operation",
      payload: {
        media_operation_ref: "media-ref",
        definition_ref: "image.text_to_image",
        definition_revision_ref: "image.text_to_image@1",
        owner_version: "12",
        progress_bps: 8100,
        candidates: [{ candidate_ref: "candidate-unknown", ordinal: 0, owner_version: "6", state: "unknown" }],
        updated_at: NOW,
        outcome_class: "irreconcilable",
        safe_failure: { code: "outcome_unknown", retry_class: "reconcile_receipt", safe_message: "Outcome needs reconciliation." },
        state: "failed",
      },
    }
    const artifact: MessagePartEnvelope = {
      part_id: "artifact-unavailable",
      message_id: "message-assistant-12345678",
      ordinal: 1,
      version: 1,
      schema_version: 1,
      lifecycle: "failed",
      kind: "artifact",
      payload: {
        artifact_ref: "artifact-ref",
        artifact_version_ref: "artifact-v1",
        owner_version: "4",
        media_class: "image",
        updated_at: NOW,
        safe_failure: { code: "artifact_unavailable", retry_class: "after_user_action", safe_message: "Artifact is unavailable." },
        availability: "unavailable",
      },
    }
    const cost: MessagePartEnvelope = {
      part_id: "cost-unavailable",
      message_id: "message-assistant-12345678",
      ordinal: 2,
      version: 1,
      schema_version: 1,
      lifecycle: "failed",
      kind: "cost",
      payload: {
        media_operation_ref: "media-ref",
        cost_projection_ref: "cost-ref",
        owner_version: "3",
        freshness: "unavailable",
        updated_at: NOW,
        safe_reason: "Rating projection is temporarily unavailable.",
        state: "unavailable",
      },
    }
    const store = createChatProjectionStore()
    store.hydrate(snapshotWithAssistantParts([terminal, artifact, cost]))
    expect(store.getSnapshot().messages[1]?.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "media-operation", state: "failed", outcomeClass: "irreconcilable", failure: { code: "outcome_unknown", retryClass: "reconcile_receipt", safeMessage: "Outcome needs reconciliation." }, candidates: [expect.objectContaining({ state: "unknown" })] }),
      expect.objectContaining({ kind: "artifact", availability: "unavailable", failure: { code: "artifact_unavailable", retryClass: "after_user_action", safeMessage: "Artifact is unavailable." } }),
      expect.objectContaining({ kind: "cost", state: "unavailable", freshness: "unavailable", safeReason: "Rating projection is temporarily unavailable." }),
    ]))

    const reopened: MessagePartEnvelope = {
      ...terminal,
      version: 2,
      lifecycle: "streaming",
      payload: {
        media_operation_ref: "media-ref",
        definition_ref: "image.text_to_image",
        definition_revision_ref: "image.text_to_image@1",
        owner_version: "13",
        progress_bps: 9000,
        candidates: [{ candidate_ref: "candidate-unknown", ordinal: 0, owner_version: "7", state: "validating" }],
        updated_at: NOW,
        state: "active",
      },
    }
    store.dispatch({ type: "event", event: event({ kind: "message.part.updated", payload: { part: reopened } }) })
    expect(store.getSnapshot().messages[1]?.parts[0]).toMatchObject({ state: "failed", ownerVersion: "12" })
    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "media_terminal_state_conflict" })
  })

  it("rejects part version regression without mutating the current projection", () => {
    const store = createChatProjectionStore()
    store.hydrate(snapshot())
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
    store.hydrate(launching)
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
