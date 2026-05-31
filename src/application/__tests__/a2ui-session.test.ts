import { afterEach, describe, expect, it, vi } from "vitest"
import { MessageProcessor } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "@/interfaces/a2ui/catalog"
import { buildRunUrl, feedA2uiLine, submitPermissionDecision } from "../a2ui-session"

afterEach(() => {
  vi.restoreAllMocks()
})

describe("buildRunUrl", () => {
  it("adds the optional permission fixture query param", () => {
    const url = buildRunUrl({
      baseUrl: "http://127.0.0.1:3001",
      sessionId: "ses_1",
      conversationId: "ses_1",
      input: "hello",
      fixture: "permission",
    })
    expect(url).toContain("/sessions/ses_1/runs")
    expect(url).toContain("fixture=permission")
  })
})

describe("feedA2uiLine", () => {
  it("parses a JSON op line and feeds the processor incrementally", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    feedA2uiLine(processor, JSON.stringify({ version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } }))
    feedA2uiLine(processor, JSON.stringify({ version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Thread", children: [] }] } }))
    expect(processor.model.getSurface("s")).toBeTruthy()
  })

  it("ignores malformed lines without throwing", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    expect(() => feedA2uiLine(processor, "not json")).not.toThrow()
    expect(() => feedA2uiLine(processor, JSON.stringify({ nope: 1 }))).not.toThrow()
  })
})

describe("submitPermissionDecision", () => {
  it("posts the resolved decision body to kokoro-session", async () => {
    const originalFetch = globalThis.fetch
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch
    globalThis.fetch = fetchMock

    try {
      await submitPermissionDecision({
        baseUrl: "http://127.0.0.1:3001",
        sessionId: "ses_1",
        requestId: "perm_run_1",
        decision: { decision: "allow", scope: "once" },
      })
    } finally {
      globalThis.fetch = originalFetch
    }

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/sessions/ses_1/permissions/perm_run_1/decision",
      expect.objectContaining({ method: "POST" }),
    )
  })
})
