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
}>) {
  const streams: OpenEventsInput[] = []
  const unavailable = async (..._args: readonly unknown[]): Promise<never> => {
    throw new Error("operation is outside this fixture")
  }
  const client = {
    fetchSnapshot: input.fetchSnapshot,
    hydrate: vi.fn(async (): Promise<SessionHydration> => ({
      kind: "ready",
      snapshot: input.initial,
      watermark: input.initial.snapshot_watermark,
      cursor: input.initial.snapshot_watermark.cursor as SessionCursor,
    })),
    listSessions: unavailable,
    createSession: unavailable,
    submitMessage: unavailable,
    editMessage: unavailable,
    regenerateMessage: unavailable,
    forkBranch: unavailable,
    activateBranch: unavailable,
    cancelRun: unavailable,
    decideAction: unavailable,
    decidePlan: unavailable,
    getCommandReceipt: unavailable,
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
})
