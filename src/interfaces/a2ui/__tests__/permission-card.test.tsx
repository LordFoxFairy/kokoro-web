import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { A2uiSurface } from "@a2ui/react/v0_9"
import { MessageProcessor, type A2uiMessage } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "../catalog"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("PermissionCard (kokoro/chat/v1)", () => {
  it("renders ask actions and posts allow-once", async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch
    globalThis.fetch = fetchMock

    try {
      const processor = new MessageProcessor([kokoroChatCatalog])
      processor.processMessages([
        { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } },
        { version: "v0.9", updateComponents: { surfaceId: "s", components: [
          { id: "root", component: "Thread", children: ["perm_run_1"] },
          { id: "perm_run_1", component: "PermissionCard", sessionId: "s", requestPath: { path: "/permissions/perm_run_1" } },
        ] } },
        { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/permissions/perm_run_1", value: {
          requestId: "perm_run_1",
          decision: "ask",
          scope: "session",
          message: "我想访问这个外部资源，可以吗？",
          options: ["once", "session", "deny"],
          kind: "permission",
        } } },
      ] as A2uiMessage[])

      render(<A2uiSurface surface={processor.model.getSurface("s")!} />)
      fireEvent.click(screen.getByRole("button", { name: "Allow once" }))

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it("renders a resolved card without action buttons", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    processor.processMessages([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } },
      { version: "v0.9", updateComponents: { surfaceId: "s", components: [
        { id: "root", component: "Thread", children: ["perm_run_1"] },
        { id: "perm_run_1", component: "PermissionCard", sessionId: "s", requestPath: { path: "/permissions/perm_run_1" } },
      ] } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/permissions/perm_run_1", value: {
        requestId: "perm_run_1",
        decision: "allow",
        scope: "once",
        message: "这一步已经允许继续了。",
        kind: "permission",
      } } },
    ] as A2uiMessage[])

    render(<A2uiSurface surface={processor.model.getSurface("s")!} />)
    expect(screen.getByText("这一步已经允许继续了。")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Deny" })).toBeNull()
  })
})
