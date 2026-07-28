import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"
import { __clearSiteResolveCache } from "@/lib/server/site"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_BASE_URL: "http://site.test",
  KOKORO_SITE_ID: "site-a",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function sessionCookie(siteId = "site-a", accessExp = nowSec() + 3600): string {
  const sealed = sealEnvelope(
    { runtime_jwt: "rt.jwt.sig", access_exp: accessExp, refresh_token: "rt-refresh", user_id: "u1", namespace: "team_1", site_id: siteId, exp: nowSec() + 3600 },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )
  return `kokoro_session=${sealed}`
}

function siteResponse(siteId: string): Response {
  return Response.json({
    data: {
      context: {
        siteId,
        brand: { name: siteId, logoUrl: null, themeColor: null },
      },
    },
  })
}

function refreshResponse(siteId = "site-a"): Response {
  return Response.json({
    data: {
      token: "new.jwt.sig",
      namespace: "team_1",
      site_id: siteId,
      refresh_token: "rotated-refresh",
      refresh_expires_at: new Date((nowSec() + 3600) * 1000).toISOString(),
    },
  })
}

function params(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) }
}

beforeEach(() => {
  __clearSiteResolveCache()
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __clearSiteResolveCache()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe("/api/session/[...path] proxy", () => {
  it("injects Bearer from the envelope and forwards to the real session base", async () => {
    const fetchMock = vi.fn(async (target: string | URL, _init?: RequestInit) => {
      void _init
      const url = target.toString()
      if (url.startsWith("http://site.test/site-context/resolve")) return siteResponse("site-a")
      if (url.startsWith("http://session.test/")) {
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1?x=1", {
        headers: { cookie: sessionCookie(), host: "site-a.example" },
      }),
      params(["sessions", "ses_1"]),
    )
    expect(res.status).toBe(200)

    const [target, init] = fetchMock.mock.calls[1]!
    expect(target.toString()).toBe("http://session.test/sessions/ses_1?x=1")
    expect((init!.headers as Headers).get("authorization")).toBe("Bearer rt.jwt.sig")
  })

  it("streams an SSE response through unchanged (content-type + body)", async () => {
    const upstream = new Response("data: hello\n\n", { status: 200, headers: { "content-type": "text/event-stream" } })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (target: string | URL) =>
        target.toString().startsWith("http://site.test/") ? siteResponse("site-a") : upstream,
      ),
    )
    const { GET } = await import("@/app/api/session/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1/events", {
        headers: { cookie: sessionCookie(), host: "site-a.example", accept: "text/event-stream", "last-event-id": "42" },
      }),
      params(["sessions", "ses_1", "events"]),
    )
    expect(res.headers.get("content-type")).toBe("text/event-stream")
    expect(await res.text()).toBe("data: hello\n\n")
  })

  it("forwards the SSE resume header (last-event-id) upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL, _init?: RequestInit) => {
      void _init
      return target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("", { status: 200, headers: { "content-type": "text/event-stream" } })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")
    await GET(
      new Request("http://localhost/api/session/sessions/ses_1/events", {
        headers: { cookie: sessionCookie(), host: "site-a.example", accept: "text/event-stream", "last-event-id": "42" },
      }),
      params(["sessions", "ses_1", "events"]),
    )
    const [, init] = fetchMock.mock.calls[1]!
    expect((init!.headers as Headers).get("last-event-id")).toBe("42")
  })

  it("returns 401 when there is no envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue(siteResponse("site-a"))
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")
    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1", { headers: { host: "site-a.example" } }),
      params(["sessions", "ses_1"]),
    )
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledOnce()
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

  it("unknown Host fails closed before refresh and session upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return new Response("{}", { status: 404 })
      if (url === "http://user.test/auth/refresh") return refreshResponse()
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "unknown.example" },
      }),
      params(["sessions", "ses_1"]),
    )

    expect(res.status).toBe(404)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=unknown.example",
    ])
  })

  it("cross-Site Host rejects the envelope before refresh and session upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-b")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-b.example" },
      }),
      params(["sessions", "ses_1"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-b.example",
    ])
  })

  it("refresh issuer 返回跨 Site 成功响应时拒绝会话且不触达 session upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-b")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/session/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/session/sessions/ses_1", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-a.example" },
      }),
      params(["sessions", "ses_1"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://user.test/auth/refresh",
    ])
  })
})
