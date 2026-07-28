import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"
import { __clearSiteResolveCache } from "@/lib/server/site"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_BASE_URL: "http://site.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_INTERNAL_SECRET_WEB_BFF: "svc-secret",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function sessionCookie(siteId = "site-a", accessExp = nowSec() + 3600): string {
  const sealed = sealEnvelope(
    {
      runtime_jwt: "rt.jwt.sig",
      access_exp: accessExp,
      refresh_token: "rt-refresh",
      user_id: "u1",
      namespace: "team_1",
      site_id: siteId,
      exp: nowSec() + 3600,
    },
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

function chunkedPost(url: string, chunks: Uint8Array[], headers: Record<string, string>): Request {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk === undefined) {
        controller.close()
      } else {
        controller.enqueue(chunk)
      }
    },
  })
  return new Request(url, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" })
}

beforeEach(() => {
  __clearSiteResolveCache()
  for (const [key, value] of Object.entries(ENV)) process.env[key] = value
  vi.stubEnv("NODE_ENV", "production")
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __clearSiteResolveCache()
  for (const key of Object.keys(ENV)) delete process.env[key]
})

describe("/api/team/[...path] proxy", () => {
  it("resolves Host Site before forwarding the sealed user principal", async () => {
    const fetchMock = vi.fn(async (target: string | URL, _init?: RequestInit) => {
      void _init
      return target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : Response.json({ data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/team/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/team/me/teams", {
        headers: { cookie: sessionCookie(), host: "site-a.example" },
      }),
      params(["me", "teams"]),
    )

    expect(res.status).toBe(200)
    const [target, init] = fetchMock.mock.calls[1]!
    expect(target.toString()).toBe("http://user.test/bff/me/teams")
    const headers = init!.headers as Headers
    expect(headers.get("x-kokoro-service")).toBe("web-bff")
    expect(headers.get("x-kokoro-internal-secret")).toBe("svc-secret")
    expect(headers.get("x-user-id")).toBe("u1")
  })

  it("unknown Host fails closed before refresh and user upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return new Response("{}", { status: 404 })
      if (url === "http://user.test/auth/refresh") return refreshResponse()
      return Response.json({ data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/team/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/team/me/teams", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "unknown.example" },
      }),
      params(["me", "teams"]),
    )

    expect(res.status).toBe(404)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=unknown.example",
    ])
  })

  it("cross-Site Host rejects the envelope before refresh and user upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-b")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      return Response.json({ data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/team/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/team/me/teams", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-b.example" },
      }),
      params(["me", "teams"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-b.example",
    ])
  })

  it("refresh issuer 返回跨 Site 成功响应时拒绝会话且不触达 user upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-b")
      return Response.json({ data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/team/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/team/me/teams", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-a.example" },
      }),
      params(["me", "teams"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://user.test/auth/refresh",
    ])
  })

  it("rejects a chunked Team JSON body after the 64 KiB hard cap", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      return Response.json({ data: [] })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/team/[...path]/route")
    const request = chunkedPost(
      "http://localhost/api/team/teams/team_1/invites",
      [new Uint8Array(64 * 1024), new Uint8Array(1)],
      {
        cookie: sessionCookie("site-a", nowSec() + 60),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "application/json",
      },
    )

    const res = await POST(request, params(["teams", "team_1", "invites"]))

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "request_body_too_large" })
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
    ])
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("does not forward upstream Set-Cookie or Location headers", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "attacker=1",
              location: "https://attacker.example",
            },
          }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/team/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/team/me/teams", {
        headers: { cookie: sessionCookie(), host: "site-a.example" },
      }),
      params(["me", "teams"]),
    )

    expect(res.headers.get("set-cookie")).toBeNull()
    expect(res.headers.get("location")).toBeNull()
  })
})
