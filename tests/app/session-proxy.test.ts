import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function sessionCookie(): string {
  const sealed = sealEnvelope(
    { runtime_jwt: "rt.jwt.sig", user_id: "u1", namespace: "team_1", site_id: "site-a", exp: nowSec() + 60 },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )
  return `kokoro_session=${sealed}`
}

function params(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) }
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe("/api/session/[...path] proxy", () => {
  it("injects Bearer from the envelope and forwards to the real session base", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1?x=1", { headers: { cookie: sessionCookie() } }),
      params(["sessions", "ses_1"]),
    )
    expect(res.status).toBe(200)

    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(target).toBe("http://session.test/sessions/ses_1?x=1")
    expect((init.headers as Headers).get("authorization")).toBe("Bearer rt.jwt.sig")
  })

  it("streams an SSE response through unchanged (content-type + body)", async () => {
    const upstream = new Response("data: hello\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(upstream))
    const { GET } = await import("@/app/api/session/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1/events", {
        headers: { cookie: sessionCookie(), accept: "text/event-stream", "last-event-id": "42" },
      }),
      params(["sessions", "ses_1", "events"]),
    )
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    expect(await res.text()).toBe("data: hello\n\n")
  })

  it("forwards the SSE resume header (last-event-id) upstream", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }))
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")
    await GET(
      new Request("http://localhost/api/session/sessions/ses_1/events", {
        headers: { cookie: sessionCookie(), accept: "text/event-stream", "last-event-id": "42" },
      }),
      params(["sessions", "ses_1", "events"]),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).get("last-event-id")).toBe("42")
  })

  it("returns 401 when there is no envelope", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { GET } = await import("@/app/api/session/[...path]/route")
    const res = await GET(new Request("http://localhost/api/session/sessions/ses_1"), params(["sessions", "ses_1"]))
    expect(res.status).toBe(401)
  })

  it("rejects a cross-origin mutation (POST) even with a valid envelope", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/session/[...path]/route")
    const res = await POST(
      new Request("http://localhost/api/session/sessions/ses_1/messages", {
        method: "POST",
        headers: { cookie: sessionCookie(), origin: "http://evil.test", "content-type": "application/json" },
        body: "{}",
      }),
      params(["sessions", "ses_1", "messages"]),
    )
    expect(res.status).toBe(403)
  })
})
