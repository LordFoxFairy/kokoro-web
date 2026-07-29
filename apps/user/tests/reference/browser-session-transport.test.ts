import { describe, expect, it, vi } from "vitest"

import { createBrowserSessionTransport } from "@/reference/browser-session-transport"

describe("same-origin Browser v3 transport", () => {
  it("keeps the Session path relative and never accepts authority material", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessions: [], index_watermark: "index-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    const transport = createBrowserSessionTransport({ fetcher })

    await transport.request({ method: "GET", path: "/v1/sessions?project_ref=project-1" })

    expect(fetcher).toHaveBeenCalledWith(
      "/api/session/v1/sessions?project_ref=project-1",
      expect.objectContaining({ credentials: "same-origin", cache: "no-store" }),
    )
  })

  it("preserves the SSE body for the contract client and forwards the durable cursor header", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("event: stream.draining\ndata: {}\n\n"))
        controller.close()
      },
    })
    const fetcher = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }))
    const transport = createBrowserSessionTransport({ fetcher })

    const response = await transport.stream({
      method: "GET",
      path: "/v1/sessions/session-1/events",
      headers: { accept: "text/event-stream", "last-event-id": "signed.cursor.4" },
    })

    expect(response.body).toBe(body)
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ "last-event-id": "signed.cursor.4" }),
    }))
  })

  it("rejects an absolute or traversal path before fetch", async () => {
    const fetcher = vi.fn()
    const transport = createBrowserSessionTransport({ fetcher })

    await expect(transport.request({ method: "GET", path: "https://evil.test/v1/sessions" })).rejects.toThrow("relative")
    await expect(transport.request({ method: "GET", path: "/v1/../admin" })).rejects.toThrow("relative")
    expect(fetcher).not.toHaveBeenCalled()
  })
})
