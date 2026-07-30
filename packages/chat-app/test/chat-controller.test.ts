import {
  SessionClientError,
  type EventStreamHandle,
  type OpenEventsInput,
  type SessionClient,
  type SessionCursor,
  type SessionHydration,
} from "@kokoro/session-client"
import type {
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { createChatController } from "../src/chat-controller.js"
import type { SessionCommandRecoveryRecord, SessionCommandRecoveryStore } from "../src/command-recovery.js"

const NOW = "2026-07-29T00:00:00.000Z"

function snapshot(branchId: string, cursor: string, durableSeq: string): SessionSnapshot {
  return {
    session: {
      session_id: "session-12345678",
      project_ref: "project-12345678",
      title: "Recovery",
      lifecycle: "active",
      active_branch_id: branchId,
      version: Number(durableSeq),
      created_at: NOW,
      updated_at: NOW,
    },
    branches: [],
    messages: [],
    run_launches: [],
    runs: [],
    controls: [],
    costs: [],
    model_history: [],
    snapshot_watermark: {
      cursor,
      stream_epoch: "epoch-12345678",
      durable_seq: durableSeq,
      projection_version: Number(durableSeq),
    },
  }
}

function branchActivated(branchId: string): SessionEvent {
  return {
    kind: "branch.activated",
    event_id: "event-12345678",
    cursor: "signed.cursor.2",
    session_id: "session-12345678",
    stream_epoch: "epoch-12345678",
    durable_seq: "2",
    projection_version: 2,
    schema_revision: 3,
    recorded_at: NOW,
    payload: { branch_id: branchId, session_version: 2 },
  }
}

function clientFixture(input: Readonly<{
  initial: SessionSnapshot
  fetchSnapshot: SessionClient["fetchSnapshot"]
  hydrate?: SessionClient["hydrate"]
  getCommandReceipt?: SessionClient["getCommandReceipt"]
  submitMessage?: SessionClient["submitMessage"]
}>) {
  const streams: OpenEventsInput[] = []
  const unavailable = async (..._args: readonly unknown[]): Promise<never> => {
    throw new Error("operation is outside this fixture")
  }
  const client = {
    fetchSnapshot: input.fetchSnapshot,
    hydrate: input.hydrate ?? vi.fn(async (): Promise<SessionHydration> => ({
      kind: "ready",
      snapshot: input.initial,
      watermark: input.initial.snapshot_watermark,
      cursor: input.initial.snapshot_watermark.cursor as SessionCursor,
    })),
    listSessions: unavailable,
    createSession: unavailable,
    submitMessage: input.submitMessage ?? unavailable,
    editMessage: unavailable,
    regenerateMessage: unavailable,
    forkBranch: unavailable,
    activateBranch: unavailable,
    cancelRun: unavailable,
    decideAction: unavailable,
    decidePlan: unavailable,
    getCommandReceipt: input.getCommandReceipt ?? unavailable,
    updateSession: unavailable,
    archiveSession: unavailable,
    restoreSession: unavailable,
    trashSession: unavailable,
    putPreference: unavailable,
    listFolders: unavailable,
    createFolder: unavailable,
    updateFolder: unavailable,
    deleteFolder: unavailable,
    openEvents(eventInput: OpenEventsInput): EventStreamHandle {
      streams.push(eventInput)
      return { ready: Promise.resolve(), close: vi.fn() }
    },
  } satisfies SessionClient
  return { client, streams }
}

describe("Chat recovery controller", () => {
  it("does not carry one conversation's model draft selection into another conversation", async () => {
    const first = snapshot("branch-first-12345678", "signed.cursor.1", "1")
    const second: SessionSnapshot = {
      ...snapshot("branch-second-12345678", "signed.cursor.2", "2"),
      session: {
        ...snapshot("branch-second-12345678", "signed.cursor.2", "2").session,
        session_id: "session-second-12345678",
      },
      model_history: [{ model_option_revision_ref: "model-option-second-12345678", label: "Second" }],
    }
    const hydrate = vi.fn<SessionClient["hydrate"]>(async (sessionId) => {
      const selected = sessionId === "session-second-12345678" ? second : first
      return {
        kind: "ready",
        snapshot: selected,
        watermark: selected.snapshot_watermark,
        cursor: selected.snapshot_watermark.cursor as SessionCursor,
      }
    })
    const { client } = clientFixture({ initial: first, fetchSnapshot: vi.fn(async () => first), hydrate })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-first-12345678",
        publishedAt: NOW,
        options: [
          { modelOptionRevisionRef: "model-option-first-12345678", optionKey: "first", label: "First", inputModalities: ["text"], outputModalities: ["text"], supportedEfforts: [], badges: [], availability: "available" },
          { modelOptionRevisionRef: "model-option-second-12345678", optionKey: "second", label: "Second", inputModalities: ["text"], outputModalities: ["text"], supportedEfforts: [], badges: [], availability: "available" },
        ],
      },
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    expect(controller.getSnapshot().selectedModelOptionRevisionRef).toBe("model-option-first-12345678")
    await controller.open("session-second-12345678")
    expect(controller.getSnapshot().selectedModelOptionRevisionRef).toBe("model-option-second-12345678")
    controller.close()
  })

  it("repairs a conflicting Run projection version instead of regressing visible state", async () => {
    const base = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const initial: SessionSnapshot = {
      ...base,
      runs: [{
        run_id: "run-12345678",
        launch_id: "launch-12345678",
        branch_id: "branch-original-12345678",
        assistant_message_id: "message-assistant-12345678",
        execution_status: "running",
        cost_status: "committed",
        last_durable_cursor: "signed.cursor.1",
        projection_version: 2,
      }],
    }
    const repaired: SessionSnapshot = {
      ...initial,
      runs: [{ ...initial.runs[0]!, execution_status: "completed", projection_version: 3 }],
      snapshot_watermark: { ...initial.snapshot_watermark, cursor: "signed.cursor.2", durable_seq: "2" },
    }
    const fetchSnapshot = vi.fn(async () => repaired)
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    streams[0]?.onEvent({
      kind: "run.view.updated",
      event_id: "event-conflict-12345678",
      cursor: "signed.cursor.2",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      durable_seq: "2",
      projection_version: 2,
      schema_revision: 3,
      recorded_at: NOW,
      payload: { run: { ...initial.runs[0]!, execution_status: "failed" } },
    }, "signed.cursor.2" as SessionCursor)

    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(controller.getSnapshot().snapshot).toBe(repaired))
    expect(controller.getSnapshot().projection.activeRunId).toBeNull()
    controller.close()
  })

  it("repairs a projection-invalidating event from a fresh authoritative snapshot", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const repaired = snapshot("branch-repaired-12345678", "signed.cursor.2", "2")
    const fetchSnapshot = vi.fn(async () => repaired)
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    streams[0]?.onEvent(branchActivated("branch-repaired-12345678"), "signed.cursor.2" as SessionCursor)
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(controller.getSnapshot().snapshot).toBe(repaired))

    expect(streams).toHaveLength(2)
    expect(controller.getSnapshot().projection).toMatchObject({
      activeBranchId: "branch-repaired-12345678",
      repair: { required: false },
    })
    controller.close()
  })

  it("keeps a safe retry action when snapshot repair is temporarily unavailable", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const repaired = snapshot("branch-repaired-12345678", "signed.cursor.2", "2")
    const fetchSnapshot = vi.fn<SessionClient["fetchSnapshot"]>()
      .mockRejectedValueOnce(new SessionClientError("network", "offline"))
      .mockResolvedValueOnce(repaired)
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    streams[0]?.onConnection({ kind: "repair_required", recovery: { kind: "rehydrate", reason: "cursor_expired" } })
    await vi.waitFor(() => expect(controller.getSnapshot().failure).toMatchObject({
      code: "INTERNAL_UNAVAILABLE",
      action: "refetch_snapshot",
      retryClass: "immediate",
    }))

    await expect(controller.recover()).resolves.toBe(true)
    expect(controller.getSnapshot().snapshot).toBe(repaired)
    expect(controller.getSnapshot().failure).toBeNull()
    controller.close()
  })

  it("resumes only the exact durable receipt after a browser refresh", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const refreshed = snapshot("branch-original-12345678", "signed.cursor.2", "2")
    const record: SessionCommandRecoveryRecord = {
      schemaVersion: 1,
      operation: "submit_message",
      command: {
        command_id: "command-12345678",
        idempotency_key: "web:command-12345678",
        digest_algorithm: "SHA256_CANONICAL_JSON_V2",
        request_digest: "a".repeat(64),
      },
      sessionId: "session-12345678",
      clientDraftRevision: "draft-revision-12345678",
      createdAt: 1_000,
    }
    const clear = vi.fn()
    const recoveryStore = {
      load: () => record,
      save: vi.fn(),
      clear,
    } satisfies SessionCommandRecoveryStore
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => ({
      command_receipt: {
        operation: "submit_message",
        command_id: record.command.command_id,
        idempotency_key: record.command.idempotency_key,
        digest_algorithm: record.command.digest_algorithm,
        request_digest: record.command.request_digest,
        updated_at: NOW,
        status: "accepted",
        payload: {
          kind: "run-launch-created",
          payload: {
            session_id: "session-12345678",
            branch_id: "branch-original-12345678",
            trigger_message_id: "message-user-12345678",
            assistant_message_id: "message-assistant-12345678",
            launch_id: "launch-12345678",
            proposed_run_id: "run-12345678",
            session_version: 2,
            branch_version: 2,
          },
        },
      },
    }))
    const fetchSnapshot = vi.fn(async () => refreshed)
    const { client } = clientFixture({ initial, fetchSnapshot, getCommandReceipt })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
      commandRecoveryStore: recoveryStore,
    })

    await controller.open("session-12345678")
    await expect(controller.resumePendingCommand()).resolves.toBe(true)

    expect(getCommandReceipt).toHaveBeenCalledWith(record.command.command_id, {
      operation: record.operation,
      idempotency_key: record.command.idempotency_key,
      digest_algorithm: record.command.digest_algorithm,
      request_digest: record.command.request_digest,
    })
    expect(clear).toHaveBeenCalledWith(record.command.command_id)
    expect(controller.getSnapshot().snapshot).toBe(refreshed)
    expect(controller.getSnapshot().appliedDraft).toEqual({
      sessionId: "session-12345678",
      revision: "draft-revision-12345678",
    })
    controller.close()
  })

  it("persists the receipt identity before dispatch and retains it after an ambiguous response", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const save = vi.fn()
    const clear = vi.fn()
    const recoveryStore = {
      load: () => null,
      save,
      clear,
    } satisfies SessionCommandRecoveryStore
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async () => {
      throw new TypeError("response lost")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => {
      throw new TypeError("receipt temporarily unavailable")
    })
    const { client } = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => initial),
      getCommandReceipt,
      submitMessage,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: "project-12345678",
      commandRecoveryStore: recoveryStore,
    })

    await controller.open("session-12345678")
    await expect(controller.submit("hello", [{
      asset_ref: "asset-12345678",
      asset_version_ref: "asset-version-12345678",
      asset_grant_ref: "grant-12345678",
    }])).resolves.toBe(false)

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      operation: "submit_message",
      sessionId: "session-12345678",
      command: expect.objectContaining({ digest_algorithm: "SHA256_CANONICAL_JSON_V2" }),
    }))
    expect(submitMessage).toHaveBeenCalledOnce()
    expect(submitMessage).toHaveBeenCalledWith("session-12345678", expect.objectContaining({
      attachment_refs: [{
        asset_ref: "asset-12345678",
        asset_version_ref: "asset-version-12345678",
        asset_grant_ref: "grant-12345678",
      }],
    }))
    expect(getCommandReceipt).toHaveBeenCalledOnce()
    expect(clear).not.toHaveBeenCalled()
    expect(controller.getSnapshot().failure).toMatchObject({ action: "reconcile_receipt" })

    await expect(controller.submit("a new effect")).resolves.toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(submitMessage).toHaveBeenCalledOnce()
    controller.close()
  })
})
