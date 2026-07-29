import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReferenceSessionRail } from "@/reference/reference-session-rail"
import type {
  ReferenceSessionOrganizer,
  ReferenceSessionOrganizerState,
} from "@/reference/reference-session-organizer"

afterEach(cleanup)

const state: ReferenceSessionOrganizerState = {
  phase: "ready",
  sessions: [{
    sessionId: "session-1",
    title: "Launch plan",
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

function controller(): ReferenceSessionOrganizer {
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
    createFolder: vi.fn(),
    renameFolder: vi.fn(),
    deleteFolder: vi.fn(),
    close: vi.fn(),
  }
}

describe("reference session rail", () => {
  it("exposes pin, folder move, create, rename, and confirmed delete interactions", () => {
    const value = controller()
    render(<ReferenceSessionRail
      activeSessionId="session-1"
      available
      brandName="Kokoro"
      controller={value}
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
  })
})
