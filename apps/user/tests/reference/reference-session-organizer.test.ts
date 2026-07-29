import { createHash } from "node:crypto"

import { beforeEach, describe, expect, it, vi } from "vitest"

import type { SessionClient } from "@kokoro/session-client"
import type { CommandIdentity, SessionCommandResponse } from "@kokoro/session-client/contracts"

import { createReferenceSessionOrganizer } from "@/reference/reference-session-organizer"

const NOW = "2026-07-29T12:00:00.000Z"

function listItem(input: {
  readonly id?: string
  readonly pinned?: boolean
  readonly folderId?: string
  readonly preferenceVersion?: number
} = {}) {
  const id = input.id ?? "session-1"
  return {
    session: {
      session_id: id,
      project_ref: "project-1",
      title: `Chat ${id}`,
      lifecycle: "active" as const,
      active_branch_id: `branch-${id}`,
      version: 2,
      created_at: NOW,
      updated_at: NOW,
    },
    pinned: input.pinned ?? false,
    ...(input.folderId === undefined ? {} : { folder_id: input.folderId }),
    preference_version: input.preferenceVersion ?? 4,
  }
}

function receipt(
  command: CommandIdentity,
  status: "pending" | "applied" | "denied",
  operation: "put_preference" | "create_folder" | "update_folder" | "delete_folder" = "put_preference",
): SessionCommandResponse {
  if (status === "pending") {
    return { command_receipt: {
      operation,
      ...command,
      updated_at: NOW,
      status,
      payload: { retry_class: "reconcile_receipt", action: "reconcile_receipt" },
    } }
  }
  if (status === "denied") {
    return { command_receipt: {
      operation,
      ...command,
      updated_at: NOW,
      status,
      payload: {
        code: "SESSION_VERSION_CONFLICT",
        message: "stale version",
        retry_class: "after_user_action",
        action: "refetch_snapshot",
      },
    } }
  }
  return { command_receipt: {
    operation,
    ...command,
    updated_at: NOW,
    status,
    payload: operation === "put_preference"
      ? { kind: "preference-updated", payload: {
          session_id: "session-1", pinned: true, folder_id: "folder-1", preference_version: 5,
        } }
      : operation === "delete_folder"
        ? { kind: "folder-deleted", payload: { folder_id: "folder-1", project_ref: "project-1" } }
        : { kind: "folder-updated", payload: {
            folder_id: "folder-1", project_ref: "project-1", folder_version: operation === "create_folder" ? 1 : 4,
          } },
  } }
}

function fakeClient(overrides: Partial<SessionClient> = {}) {
  return {
    listSessions: vi.fn().mockResolvedValue({
      sessions: [listItem({ folderId: "folder-1" })],
      index_watermark: "index-1",
    }),
    listFolders: vi.fn().mockResolvedValue({
      folders: [{ folder_id: "folder-1", project_ref: "project-1", name: "Work", version: 3 }],
    }),
    getCommandReceipt: vi.fn(),
    putPreference: vi.fn(),
    createFolder: vi.fn(),
    updateFolder: vi.fn(),
    deleteFolder: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe("reference session organizer", () => {
  it("hydrates nested list items and performs server-owned search/filtering", async () => {
    const client = fakeClient()
    const organizer = createReferenceSessionOrganizer({ client, projectRef: "project-1" })

    await organizer.load()
    expect(organizer.getSnapshot().sessions[0]).toEqual({
      sessionId: "session-1",
      title: "Chat session-1",
      updatedAt: NOW,
      pinned: false,
      folderId: "folder-1",
      preferenceVersion: 4,
    })

    await organizer.setQuery("  release notes  ")
    await organizer.setFilter({ kind: "pinned" })
    expect(client.listSessions).toHaveBeenLastCalledWith({
      project_ref: "project-1",
      limit: 50,
      sort: "updated_desc",
      q: "release notes",
      pinned: true,
    })
  })

  it("uses preference CAS and reconciles an uncertain receipt with the exact command identity", async () => {
    const putPreference = vi.fn<SessionClient["putPreference"]>(async (_id, body) => receipt(body.command, "pending"))
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async (_id, query) => receipt({
      command_id: _id,
      idempotency_key: query.idempotency_key,
      digest_algorithm: query.digest_algorithm,
      request_digest: query.request_digest,
    }, "applied"))
    const listSessions = vi.fn()
      .mockResolvedValueOnce({ sessions: [listItem({ folderId: "folder-1" })], index_watermark: "index-1" })
      .mockResolvedValueOnce({ sessions: [listItem({ pinned: true, folderId: "folder-1", preferenceVersion: 5 })], index_watermark: "index-2" })
    const client = fakeClient({ putPreference, getCommandReceipt, listSessions })
    const organizer = createReferenceSessionOrganizer({ client, projectRef: "project-1" })
    await organizer.load()

    await organizer.togglePinned("session-1")

    expect(putPreference).toHaveBeenCalledWith("session-1", expect.objectContaining({
      expected_version: 4,
      pinned: true,
      folder_id: "folder-1",
    }))
    const sent = putPreference.mock.calls[0]?.[1].command
    expect(sent?.request_digest).toBe(createHash("sha256").update(
      '{"expected_version":4,"folder_id":"folder-1","pinned":true}',
    ).digest("hex"))
    expect(getCommandReceipt).toHaveBeenCalledWith(sent?.command_id, {
      operation: "put_preference",
      idempotency_key: sent?.idempotency_key,
      digest_algorithm: sent?.digest_algorithm,
      request_digest: sent?.request_digest,
    })
    expect(organizer.getSnapshot().sessions[0]?.preferenceVersion).toBe(5)
    expect(organizer.getSnapshot().failure).toBeNull()
  })

  it("does not cascade a denied folder delete and refetches before presenting a useful conflict", async () => {
    const deleteFolder = vi.fn<SessionClient["deleteFolder"]>(async (_id, body) =>
      receipt(body.command, "denied", "delete_folder"))
    const client = fakeClient({ deleteFolder })
    const organizer = createReferenceSessionOrganizer({ client, projectRef: "project-1" })
    await organizer.load()
    const readsBeforeDelete = vi.mocked(client.listFolders).mock.calls.length

    await organizer.deleteFolder("folder-1")

    expect(deleteFolder).toHaveBeenCalledWith("folder-1", expect.objectContaining({ expected_version: 3 }))
    expect(vi.mocked(client.listFolders).mock.calls.length).toBe(readsBeforeDelete + 1)
    expect(organizer.getSnapshot().folders).toHaveLength(1)
    expect(organizer.getSnapshot().failure).toMatch(/changed in another window/i)
  })

  it("digests exactly each folder request body without its command or path parameter", async () => {
    const createFolder = vi.fn<SessionClient["createFolder"]>(async (body) => receipt(body.command, "applied", "create_folder"))
    const updateFolder = vi.fn<SessionClient["updateFolder"]>(async (_id, body) => receipt(body.command, "applied", "update_folder"))
    const deleteFolder = vi.fn<SessionClient["deleteFolder"]>(async (_id, body) => receipt(body.command, "applied", "delete_folder"))
    const client = fakeClient({ createFolder, updateFolder, deleteFolder })
    const organizer = createReferenceSessionOrganizer({ client, projectRef: "project-1" })
    await organizer.load()

    await organizer.createFolder("Personal")
    await organizer.renameFolder("folder-1", "Projects")
    await organizer.deleteFolder("folder-1")

    const createBody = createFolder.mock.calls[0]?.[0]
    const updateBody = updateFolder.mock.calls[0]?.[1]
    const deleteBody = deleteFolder.mock.calls[0]?.[1]
    expect(createBody?.command.request_digest).toBe(createHash("sha256")
      .update('{"name":"Personal","project_ref":"project-1"}').digest("hex"))
    expect(updateBody?.command.request_digest).toBe(createHash("sha256")
      .update('{"expected_version":3,"name":"Projects"}').digest("hex"))
    expect(deleteBody?.command.request_digest).toBe(createHash("sha256")
      .update('{"expected_version":3}').digest("hex"))
  })
})
