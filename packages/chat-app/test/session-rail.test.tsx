import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { DEFAULT_CHAT_COPY } from "../src/chat-copy.js"
import type { SessionOrganizer, SessionOrganizerState } from "../src/session-organizer.js"
import { SessionRail } from "../src/session-rail.js"

describe("SessionRail", () => {
  it("exposes a keyboard-operable mobile disclosure without hiding desktop navigation", () => {
    const unused = async (): Promise<void> => undefined
    const state: SessionOrganizerState = {
      phase: "ready",
      sessions: [],
      folders: [],
      filter: { kind: "all" },
      query: "",
      nextCursor: null,
      loadingMore: false,
      pendingAction: null,
      failure: null,
    }
    const controller = {
      getSnapshot: () => state,
      subscribe: () => () => undefined,
      load: unused,
      refresh: unused,
      loadMore: unused,
      setQuery: unused,
      setFilter: unused,
      togglePinned: unused,
      moveToFolder: unused,
      renameSession: unused,
      archiveSession: unused,
      restoreSession: unused,
      trashSession: unused,
      createFolder: unused,
      renameFolder: unused,
      deleteFolder: unused,
      close: () => undefined,
    } satisfies SessionOrganizer

    const html = renderToStaticMarkup(<SessionRail
      activeSessionId={null}
      available
      brandName="Kokoro"
      controller={controller}
      copy={DEFAULT_CHAT_COPY}
      onNew={() => undefined}
      onOpen={() => undefined}
      state={state}
    />)

    const navigationId = /aria-controls="([^"]+)"/u.exec(html)?.[1]
    expect(navigationId).toBeTruthy()
    expect(html).toContain("aria-expanded=\"false\"")
    expect(html).toContain("Open chat navigation")
    expect(html).toContain(`id="${navigationId}"`)
  })
})
