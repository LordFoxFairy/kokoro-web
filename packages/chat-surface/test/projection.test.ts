import type { SessionEvent, SessionSnapshot } from "@kokoro/session-client/contracts"
import { describe, expect, it } from "vitest"

import { createChatProjectionStore } from "../src/projection/store.js"

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
      { kind: "text", id: "part-assistant-12345678", text: "hi there" },
    ])
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
})
