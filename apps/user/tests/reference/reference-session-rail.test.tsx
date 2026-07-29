import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DEFAULT_CHAT_COPY, SessionRail } from "@kokoro/chat-app"
import type {
  SessionOrganizer,
  SessionOrganizerState,
} from "@kokoro/chat-app"

afterEach(cleanup)

const state: SessionOrganizerState = {
  phase: "ready",
  sessions: [{
    sessionId: "session-1",
    title: "Launch plan",
    lifecycle: "active",
    version: 2,
    updatedAt: "2026-07-29T12:00:00.000Z",
    pinned: false,
    folderId: null,
    preferenceVersion: 4,
  }],
  folders: [{ folderId: "folder-1", name: "Work", version: 3 }],
  filter: { kind: "all" },
  query: "",
  nextCursor: null,
  loadingMore: false,
  pendingAction: null,
  failure: null,
}

function controller(): SessionOrganizer {
  return {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    load: vi.fn(),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    setQuery: vi.fn(),
    setFilter: vi.fn(),
    togglePinned: vi.fn(),
    moveToFolder: vi.fn(),
    renameSession: vi.fn(),
    archiveSession: vi.fn(),
    restoreSession: vi.fn(),
    trashSession: vi.fn(),
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    close: vi.fn(),
  }
}

describe("session rail", () => {
  it("exposes pin, folder move, create, rename, and confirmed delete interactions", () => {
    const value = controller()
    render(<SessionRail
      activeSessionId="session-1"
      available
      brandName="Kokoro"
      controller={value}
      copy={DEFAULT_CHAT_COPY}
      onNew={() => undefined}
      onOpen={() => undefined}
      state={state}
    />)

    fireEvent.click(screen.getByRole("button", { name: "Pin Launch plan" }))
    expect(value.togglePinned).toHaveBeenCalledWith("session-1")

    fireEvent.change(screen.getByRole("combobox", { name: "Move Launch plan to folder" }), { target: { value: "folder-1" } })
    expect(value.moveToFolder).toHaveBeenCalledWith("session-1", "folder-1")

    fireEvent.change(screen.getByRole("textbox", { name: "New folder name" }), { target: { value: "Personal" } })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    expect(value.createFolder).toHaveBeenCalledWith("Personal")

    fireEvent.click(screen.getByRole("button", { name: "Rename folder Work" }))
    const rename = screen.getByRole("textbox", { name: "Rename folder Work" })
    fireEvent.change(rename, { target: { value: "Projects" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(value.renameFolder).toHaveBeenCalledWith("folder-1", "Projects")

    fireEvent.click(screen.getByRole("button", { name: "Delete folder Work" }))
    expect(screen.getByRole("group", { name: "Confirm delete folder Work" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    expect(value.deleteFolder).toHaveBeenCalledWith("folder-1")

    fireEvent.click(screen.getByRole("button", { name: "Rename" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Rename Launch plan" }), { target: { value: "Launch review" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(value.renameSession).toHaveBeenCalledWith("session-1", "Launch review")

    fireEvent.click(screen.getByRole("button", { name: "Archive" }))
    expect(value.archiveSession).toHaveBeenCalledWith("session-1")

    fireEvent.click(screen.getByRole("button", { name: "Move to trash" }))
    expect(screen.getByRole("group", { name: "Move this chat to trash? Launch plan" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }))
    expect(value.trashSession).toHaveBeenCalledWith("session-1")
  })

  it("lists archived and trashed lifecycle views and restores without exposing permanent deletion", () => {
    const value = controller()
    const archived: SessionOrganizerState = {
      ...state,
      filter: { kind: "archived" },
      sessions: [{ ...state.sessions[0]!, lifecycle: "archived" }],
    }
    render(<SessionRail
      activeSessionId={null}
      available
      brandName="Kokoro"
      controller={value}
      copy={DEFAULT_CHAT_COPY}
      onNew={() => undefined}
      onOpen={() => undefined}
      state={archived}
    />)

    fireEvent.click(screen.getByRole("button", { name: "Trash" }))
    expect(value.setFilter).toHaveBeenCalledWith({ kind: "trashed" })
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    expect(value.restoreSession).toHaveBeenCalledWith("session-1")
    expect(screen.queryByRole("button", { name: /delete permanently/i })).not.toBeInTheDocument()
  })
})
