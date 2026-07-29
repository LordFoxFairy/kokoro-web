import { describe, expect, it, vi } from "vitest"

import { createCursorPolicy, type SessionClient } from "@kokoro/session-client"
import type { SessionEvent, SessionSnapshot } from "@kokoro/session-client/contracts"
import type { SurfaceModelOptionCatalog } from "@kokoro/site-client"

import {
  createReferenceChatController,
  describeSessionFailure,
} from "@/reference/reference-chat-controller"

const NOW = "2026-07-29T12:00:00.000Z"
const CHAT_CATALOG: SurfaceModelOptionCatalog = {
  surfaceId: "chat",
  catalogRevisionRef: "chat-catalog-1",
  defaultModelOptionRevisionRef: "model-option-7",
  options: [{
    modelOptionRevisionRef: "model-option-7",
    optionKey: "chat.standard",
    label: "Standard",
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportedEfforts: [],
    badges: [],
    availability: "available",
  }],
  publishedAt: NOW,
}

function snapshot(): SessionSnapshot {
  return {
    session: {
      session_id: "session-1",
      project_ref: "project-1",
      title: "Reference chat",
      lifecycle: "active",
      active_branch_id: "branch-1",
      active_leaf_message_id: "message-user-1",
      version: 7,
      created_at: NOW,
      updated_at: NOW,
    },
    branches: [{
      branch_id: "branch-1",
      leaf_message_id: "message-user-1",
      root_message_id: "message-user-1",
      origin: "original",
      version: 3,
      created_at: NOW,
    }],
    messages: [{
      message_id: "message-user-1",
      branch_id: "branch-1",
      parent_message_id: undefined,
      run_id: undefined,
      role: "user",
      ordinal: 1,
      lifecycle: "completed",
      created_at: NOW,
      attachments: [],
      parts: [{
        part_id: "part-user-1",
        message_id: "message-user-1",
        ordinal: 1,
        kind: "text",
        schema_version: 1,
        lifecycle: "completed",
        version: 1,
        payload: { spans: [{ text: "hello" }] },
      }],
    }],
    run_launches: [],
    runs: [{
      run_id: "run-1",
      launch_id: "launch-1",
      branch_id: "branch-1",
      assistant_message_id: "message-assistant-1",
      execution_status: "running",
      cost_status: "committed",
      last_durable_cursor: "signed.cursor.4",
      projection_version: 4,
    }],
    controls: [],
    costs: [],
    capability_display: {
      capability_snapshot_ref: "capability-1",
      agent_label: "General assistant",
      skill_labels: [],
      mcp_labels: [],
      source: "admission_snapshot",
    },
    model_history: [{ model_option_revision_ref: "model-option-7", label: "Main model" }],
    snapshot_watermark: {
      cursor: "signed.cursor.4",
      stream_epoch: "epoch-1",
      durable_seq: "4",
      projection_version: 7,
    },
  }
}

function event(kind: "run.control.updated", payload: SessionEvent["payload"]): SessionEvent {
  return {
    kind,
    event_id: "event-5",
    cursor: "signed.cursor.5",
    session_id: "session-1",
    stream_epoch: "epoch-1",
    durable_seq: "5",
    projection_version: 8,
    schema_revision: 3,
    recorded_at: NOW,
    payload,
  } as SessionEvent
}

function fakeClient(input: {
  readonly value?: SessionSnapshot
  readonly onOpen?: (handlers: Parameters<SessionClient["openEvents"]>[0]) => void
} = {}): SessionClient {
  const value = input.value ?? snapshot()
  const accepted = createCursorPolicy().accept(value.snapshot_watermark.cursor)
  if (accepted.kind !== "ready") throw new Error(accepted.reason)
  return {
    fetchSnapshot: vi.fn(async () => value),
    hydrate: vi.fn(async () => ({
      kind: "ready" as const,
      snapshot: value,
      watermark: value.snapshot_watermark,
      cursor: accepted.cursor,
    })),
    listSessions: vi.fn(),
    createSession: vi.fn(async () => ({
      command_receipt: {
        operation: "create_session" as const,
        command_id: "command-create",
        idempotency_key: "idempotency-create",
        digest_algorithm: "SHA256_CANONICAL_JSON_V1" as const,
        request_digest: "c".repeat(64),
        updated_at: NOW,
        status: "accepted" as const,
        payload: {
          kind: "session-created" as const,
          payload: { session_id: "session-1", initial_branch_id: "branch-1", session_version: 1 },
        },
      },
    })),
    submitMessage: vi.fn(async () => ({
      command_receipt: {
        operation: "submit_message" as const,
        command_id: "command-submit",
        idempotency_key: "idempotency-submit",
        digest_algorithm: "SHA256_CANONICAL_JSON_V1" as const,
        request_digest: "a".repeat(64),
        updated_at: NOW,
        status: "accepted" as const,
        payload: {
          kind: "run-launch-created" as const,
          payload: {
            session_id: "session-1",
            branch_id: "branch-1",
            trigger_message_id: "message-user-2",
            assistant_message_id: "message-assistant-2",
            launch_id: "launch-2",
            proposed_run_id: "run-2",
            session_version: 8,
            branch_version: 4,
          },
        },
      },
    })),
    editMessage: vi.fn(),
    regenerateMessage: vi.fn(),
    forkBranch: vi.fn(),
    activateBranch: vi.fn(),
    cancelRun: vi.fn(async () => ({
      command_receipt: {
        operation: "cancel_run" as const,
        command_id: "command-cancel",
        idempotency_key: "idempotency-cancel",
        digest_algorithm: "SHA256_CANONICAL_JSON_V1" as const,
        request_digest: "b".repeat(64),
        updated_at: NOW,
        status: "accepted" as const,
        payload: {
          kind: "cancellation-requested" as const,
          payload: {
            session_id: "session-1",
            run_id: "run-1",
            decision_id: "decision-1",
            run_projection_version: 5,
          },
        },
      },
    })),
    decideAction: vi.fn(),
    decidePlan: vi.fn(),
    getCommandReceipt: vi.fn(),
    updateSession: vi.fn(),
    archiveSession: vi.fn(),
    restoreSession: vi.fn(),
    trashSession: vi.fn(),
    putPreference: vi.fn(),
    listFolders: vi.fn(),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    openEvents: vi.fn((handlers) => {
      input.onOpen?.(handlers)
      return { ready: Promise.resolve(), close: vi.fn() }
    }),
  }
}

describe("reference Browser v3 controller", () => {
  it("creates a chat in the bootstrap default project and opens its accepted Session receipt", async () => {
    const client = fakeClient()
    const controller = createReferenceChatController({ client, trustedLocale: "en-US", chatCatalog: CHAT_CATALOG, defaultProjectRef: "project-1" })

    await expect(controller.create()).resolves.toBe("session-1")

    expect(client.createSession).toHaveBeenCalledWith(expect.objectContaining({ project_ref: "project-1" }))
    expect(client.hydrate).toHaveBeenCalledWith("session-1")
    expect(controller.getSnapshot().selectedModelOptionRevisionRef).toBe("model-option-7")
  })

  it("hydrates the complete typed snapshot before opening SSE at its watermark", async () => {
    const client = fakeClient()
    const controller = createReferenceChatController({ client, trustedLocale: "en-US", chatCatalog: CHAT_CATALOG, defaultProjectRef: "project-1" })

    await controller.open("session-1")

    expect(controller.getSnapshot().projection.messages[0]?.parts[0]).toMatchObject({
      kind: "text",
      text: "hello",
    })
    expect(client.openEvents).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "session-1",
      watermark: snapshot().snapshot_watermark,
    }))
    expect(controller.getSnapshot().projection.connection).toEqual({ kind: "live" })
  })

  it("submits with the persisted model revision and cancels using the current run projection version", async () => {
    const client = fakeClient()
    const controller = createReferenceChatController({ client, trustedLocale: "en-US", chatCatalog: CHAT_CATALOG, defaultProjectRef: "project-1" })
    await controller.open("session-1")

    await controller.submit("continue")
    await controller.cancel()

    expect(client.submitMessage).toHaveBeenCalledWith("session-1", expect.objectContaining({
      expected_session_version: 7,
      branch_id: "branch-1",
      parent_message_id: "message-user-1",
      model_option_revision_ref: "model-option-7",
      parts: [{ schema_version: 1, kind: "text", payload: { text: "continue" } }],
    }))
    expect(client.cancelRun).toHaveBeenCalledWith("session-1", "run-1", expect.objectContaining({
      expected_run_projection_version: 4,
      reason_code: "user_requested",
    }))
  })

  it("reconciles a pending submit receipt before returning the command UI to idle", async () => {
    const client = fakeClient()
    vi.mocked(client.submitMessage).mockResolvedValueOnce({
      command_receipt: {
        operation: "submit_message", command_id: "command-pending", idempotency_key: "idempotency-pending",
        digest_algorithm: "SHA256_CANONICAL_JSON_V1", request_digest: "d".repeat(64), updated_at: NOW,
        status: "pending", payload: { retry_class: "reconcile_receipt", action: "reconcile_receipt" },
      },
    })
    vi.mocked(client.getCommandReceipt).mockResolvedValueOnce({
      command_receipt: {
        operation: "submit_message", command_id: "command-pending", idempotency_key: "idempotency-pending",
        digest_algorithm: "SHA256_CANONICAL_JSON_V1", request_digest: "d".repeat(64), updated_at: NOW,
        status: "accepted", payload: {
          kind: "run-launch-created",
          payload: { session_id: "session-1", branch_id: "branch-1", trigger_message_id: "message-2", assistant_message_id: "message-3", launch_id: "launch-2", proposed_run_id: "run-2", session_version: 8, branch_version: 4 },
        },
      },
    })
    const controller = createReferenceChatController({ client, trustedLocale: "en-US", chatCatalog: CHAT_CATALOG, defaultProjectRef: "project-1" })
    await controller.open("session-1")

    await controller.submit("continue")

    expect(client.getCommandReceipt).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ operation: "submit_message" }))
    expect(controller.getSnapshot().projection.command.state).toBe("idle")
  })

  it("keeps approval state typed and read-only while the owner command is absent", async () => {
    let openHandlers: Parameters<SessionClient["openEvents"]>[0] | undefined
    const client = fakeClient({ onOpen: (handlers) => { openHandlers = handlers } })
    const controller = createReferenceChatController({ client, trustedLocale: "en-US", chatCatalog: CHAT_CATALOG, defaultProjectRef: "project-1" })
    await controller.open("session-1")

    const accepted = createCursorPolicy().accept("signed.cursor.5")
    if (accepted.kind !== "ready") throw new Error(accepted.reason)
    openHandlers?.onEvent(event("run.control.updated", {
      control: {
        decision_id: "decision-2",
        run_id: "run-1",
        kind: "approval",
        status: "pending",
        command_receipt_ref: "receipt-2",
        updated_at: NOW,
      },
    } as SessionEvent["payload"]), accepted.cursor)

    expect(controller.getSnapshot().hitlDecisionSupported).toBe(true)
    expect(controller.getSnapshot().projection.activeRunId).toBe("run-1")
  })

  it("fails closed when a session has no published model option revision", async () => {
    const noModel = { ...snapshot(), model_history: [] }
    const client = fakeClient({ value: noModel })
    const controller = createReferenceChatController({ client, trustedLocale: "en-US", chatCatalog: null, defaultProjectRef: "project-1" })
    await controller.open("session-1")

    await controller.submit("cannot be routed")

    expect(client.submitMessage).not.toHaveBeenCalled()
    expect(controller.getSnapshot().failure).toMatchObject({
      code: "MODEL_OPTION_UNAVAILABLE",
      action: "choose_model",
      retryClass: "after_user_action",
    })
  })

  it("classifies failures by stable code and action instead of HTTP status", () => {
    expect(describeSessionFailure({
      stableCode: "SESSION_SCOPE_MISMATCH",
      action: "stop",
      retryClass: "never",
    })).toEqual({
      code: "SESSION_SCOPE_MISMATCH",
      action: "stop",
      retryClass: "never",
      message: "This session is not available in the current product context.",
    })
  })
})
