import type { SessionSnapshot } from "@kokoro/session-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { createChatProjectionStore } from "../src/projection/store.js"

const NOW = "2026-08-01T00:00:00.000Z"

function snapshot(input: Readonly<{
  sessionId?: string
  sessionVersion?: number
  branchId?: string
  snapshotRevision?: string
  text?: string
}> = {}): SessionSnapshot {
  const sessionId = input.sessionId ?? "session-12345678"
  const sessionVersion = input.sessionVersion ?? 1
  const branchId = input.branchId ?? "branch-12345678"
  const text = input.text
  const messageId = "message-assistant-12345678"
  return {
    session: {
      session_id: sessionId,
      project_ref: "project-12345678",
      title: `Thread ${sessionVersion}`,
      lifecycle: "active",
      context_policy: "standard",
      active_branch_id: branchId,
      ...(text === undefined ? {} : { active_leaf_message_id: messageId }),
      version: sessionVersion,
      created_at: NOW,
      updated_at: NOW,
    },
    branches: [{
      branch_id: branchId,
      ...(text === undefined ? {} : { root_message_id: messageId, leaf_message_id: messageId }),
      origin: "original",
      version: sessionVersion,
      created_at: NOW,
    }],
    messages: text === undefined ? [] : [{
      message_id: messageId,
      branch_id: branchId,
      role: "assistant",
      ordinal: 0,
      lifecycle: "completed",
      parts: [{
        part_id: "part-assistant-12345678",
        message_id: messageId,
        ordinal: 0,
        version: 1,
        schema_version: 1,
        lifecycle: "completed",
        kind: "text",
        payload: { spans: [{ text }] },
      }],
      attachments: [],
      created_at: NOW,
    }],
    run_launches: [],
    runs: [],
    controls: [],
    costs: [],
    model_history: [],
    snapshot_watermark: {
      snapshot_revision_ref: input.snapshotRevision ?? `snapshot.revision.${sessionVersion}`,
      projection_version: sessionVersion,
    },
    presentation_authority: {},
  }
}

describe("Chat snapshot projection", () => {
  it("hydrates one browser-safe read model from the authoritative HTTP snapshot", () => {
    const store = createChatProjectionStore()
    const listener = vi.fn()
    store.subscribe(listener)

    store.hydrate(snapshot({ text: "hello", snapshotRevision: "snapshot.revision.ready" }))

    expect(store.getSnapshot()).toMatchObject({
      session: {
        id: "session-12345678",
        title: "Thread 1",
        contextPolicy: "standard",
      },
      activeBranchId: "branch-12345678",
      snapshotRevision: "snapshot.revision.ready",
      messages: [{
        id: "message-assistant-12345678",
        status: "complete",
        parts: [{ kind: "text", text: "hello" }],
      }],
      repair: { required: false },
    })
    expect(listener).toHaveBeenCalledOnce()
  })

  it("rejects an invalid active branch without fabricating history", () => {
    const invalid = snapshot()
    const store = createChatProjectionStore()

    store.hydrate({
      ...invalid,
      session: { ...invalid.session, active_branch_id: "branch-missing-12345678" },
    })

    expect(store.getSnapshot()).toMatchObject({
      messages: [],
      repair: { required: true, reason: "snapshot_active_branch_missing" },
    })
  })

  it("preserves a newer same-Session owner when an older snapshot arrives", () => {
    const store = createChatProjectionStore()
    store.hydrate(snapshot({ sessionVersion: 2, text: "newer" }))

    store.hydrate(snapshot({ sessionVersion: 1, text: "older" }))

    expect(store.getSnapshot()).toMatchObject({
      session: { version: 2 },
      messages: [{ parts: [{ text: "newer" }] }],
      repair: { required: true, reason: "session_version_regression" },
    })
  })

  it("keeps connection, command, and repair controls outside durable content", () => {
    const store = createChatProjectionStore()
    store.hydrate(snapshot({ text: "stable" }))

    store.dispatch({ type: "connection", connection: { kind: "live" } })
    store.dispatch({ type: "command", state: "pending" })
    store.dispatch({ type: "repair", reason: "snapshot_repair_in_progress" })

    expect(store.getSnapshot()).toMatchObject({
      connection: { kind: "live" },
      command: { state: "pending" },
      messages: [{ parts: [{ text: "stable" }] }],
      repair: { required: true, reason: "snapshot_repair_in_progress" },
    })
  })
})
