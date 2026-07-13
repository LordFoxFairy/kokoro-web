import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_HUB_BASE_URL: "http://hub.test",
  KOKORO_INTERNAL_SECRET_WEB_BFF: "svc-secret",
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

describe("/api/hub/[...path] proxy", () => {
  it("injects web-bff caller creds + envelope scope/user and prefixes /hub", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"data":{"skills":[]}}', { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", { headers: { cookie: sessionCookie() } }),
      params(["self", "skills", "pool"]),
    )
    expect(res.status).toBe(200)

    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(target).toBe("http://hub.test/hub/self/skills/pool")
    const headers = init.headers as Headers
    expect(headers.get("x-kokoro-service")).toBe("web-bff")
    expect(headers.get("x-kokoro-internal-secret")).toBe("svc-secret")
    expect(headers.get("x-kokoro-namespace")).toBe("team_1")
    expect(headers.get("x-kokoro-user-id")).toBe("u1")
  })

  it("never forwards a browser-supplied scope header (identity from envelope only)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"data":{"skills":[]}}', { status: 200, headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie(), "x-kokoro-namespace": "team_evil" },
      }),
      params(["self", "skills", "pool"]),
    )
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Headers).get("x-kokoro-namespace")).toBe("team_1")
  })

  it("returns 401 when there is no envelope", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { GET } = await import("@/app/api/hub/[...path]/route")
    const res = await GET(new Request("http://localhost/api/hub/self/skills/pool"), params(["self", "skills", "pool"]))
    expect(res.status).toBe(401)
  })

  it("rejects a cross-origin mutation (POST) even with a valid envelope", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const res = await POST(
      new Request("http://localhost/api/hub/self/skills/x/disable", {
        method: "POST",
        headers: { cookie: sessionCookie(), origin: "http://evil.test" },
      }),
      params(["self", "skills", "x", "disable"]),
    )
    expect(res.status).toBe(403)
  })

  it("returns 503 when hub base url is not configured (preview build)", async () => {
    delete process.env.KOKORO_HUB_BASE_URL
    vi.stubGlobal("fetch", vi.fn())
    const { GET } = await import("@/app/api/hub/[...path]/route")
    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", { headers: { cookie: sessionCookie() } }),
      params(["self", "skills", "pool"]),
    )
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe("hub_not_configured")
  })
})
