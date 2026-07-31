import { describe, expect, it, vi } from "vitest"

import { createSessionOrganizer } from "../src/session-organizer.js"

const NOW = "2026-07-31T00:00:00.000Z"

describe("Session organizer context policy", () => {
  it("fails closed if an upstream history page accidentally contains a temporary Session", async () => {
    const unavailable = async (): Promise<never> => {
      throw new Error("operation is outside this fixture")
    }
    const item = (sessionId: string, contextPolicy: "standard" | "temporary") => ({
      session: {
        session_id: sessionId,
        project_ref: "project-12345678",
        title: contextPolicy === "standard" ? "Visible chat" : "Temporary chat",
        lifecycle: "active" as const,
        context_policy: contextPolicy,
        active_branch_id: "branch-12345678",
        version: 1,
        created_at: NOW,
        updated_at: NOW,
      },
      pinned: false,
      preference_version: 1,
    })
    const client = {
      listSessions: vi.fn(async () => ({
        sessions: [
          item("session-standard-12345678", "standard"),
          item("session-temporary-12345678", "temporary"),
        ],
        index_watermark: "index-12345678",
      })),
      listFolders: vi.fn(async () => ({ folders: [], index_watermark: "folders-12345678" })),
      getCommandReceipt: unavailable,
      updateSession: unavailable,
      archiveSession: unavailable,
      restoreSession: unavailable,
      trashSession: unavailable,
      putPreference: unavailable,
      createFolder: unavailable,
      updateFolder: unavailable,
      deleteFolder: unavailable,
    } satisfies Parameters<typeof createSessionOrganizer>[0]["client"]
    const organizer = createSessionOrganizer({ client, projectRef: "project-12345678" })

    await organizer.load()

    expect(organizer.getSnapshot().sessions.map(({ sessionId }) => sessionId)).toEqual([
      "session-standard-12345678",
    ])
    organizer.close()
  })
})
