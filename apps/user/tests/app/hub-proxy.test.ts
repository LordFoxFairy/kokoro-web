import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"
import { __clearSiteResolveCache } from "@/lib/server/site"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_BASE_URL: "http://site.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_HUB_BASE_URL: "http://hub.test",
  KOKORO_INTERNAL_SECRET_WEB_BFF: "svc-secret",
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
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __clearSiteResolveCache()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe("/api/hub/[...path] proxy", () => {
  it("injects web-bff caller creds + envelope scope/user and prefixes /hub", async () => {
    const fetchMock = vi.fn(async (target: string | URL, _init?: RequestInit) => {
      void _init
      return target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response('{"data":{"skills":[]}}', {
            status: 200,
            headers: { "content-type": "application/json" },
          })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie(), host: "site-a.example" },
      }),
      params(["self", "skills", "pool"]),
    )
    expect(res.status).toBe(200)

    const [target, init] = fetchMock.mock.calls[1]!
    expect(target.toString()).toBe("http://hub.test/hub/self/skills/pool")
    const headers = init!.headers as Headers
    expect(headers.get("x-kokoro-service")).toBe("web-bff")
    expect(headers.get("x-kokoro-internal-secret")).toBe("svc-secret")
    expect(headers.get("x-kokoro-namespace")).toBe("team_1")
    expect(headers.get("x-kokoro-user-id")).toBe("u1")
  })

  it("never forwards a browser-supplied scope header (identity from envelope only)", async () => {
    const fetchMock = vi.fn(async (target: string | URL, _init?: RequestInit) => {
      void _init
      return target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response('{"data":{"skills":[]}}', {
            status: 200,
            headers: { "content-type": "application/json" },
          })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie(), host: "site-a.example", "x-kokoro-namespace": "team_evil" },
      }),
      params(["self", "skills", "pool"]),
    )
    const [, init] = fetchMock.mock.calls[1]!
    expect((init!.headers as Headers).get("x-kokoro-namespace")).toBe("team_1")
  })

  it("returns 401 when there is no envelope", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")
    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", { headers: { host: "site-a.example" } }),
      params(["self", "skills", "pool"]),
    )
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledOnce()
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

  it("unknown Host fails closed before refresh and hub upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return new Response("{}", { status: 404 })
      if (url === "http://user.test/auth/refresh") return refreshResponse()
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "unknown.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.status).toBe(404)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=unknown.example",
    ])
  })

  it("cross-Site Host rejects the envelope before refresh and hub upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-b")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-b.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-b.example",
    ])
  })

  it("refresh issuer 返回跨 Site 成功响应时拒绝会话且不触达 hub upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-b")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-a.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://user.test/auth/refresh",
    ])
  })

  it("rejects a chunked non-upload Hub body after the 256 KiB hard cap", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const request = chunkedPost(
      "http://localhost/api/hub/self/mcp/secrets",
      [new Uint8Array(256 * 1024), new Uint8Array(1)],
      {
        cookie: sessionCookie(),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "application/json",
      },
    )

    const res = await POST(request, params(["self", "mcp", "secrets"]))

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "request_body_too_large" })
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
    ])
  })

  it("pre-rejects a declared Hub upload over the downstream 96 MiB HTTP limit", async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls >= 100) {
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array([1]))
      },
    })
    const request = new Request("http://localhost/api/hub/self/skills/upload/preview", {
      method: "POST",
      headers: {
        cookie: sessionCookie(),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
        "content-length": String(96 * 1024 * 1024 + 1),
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")

    const res = await POST(request, params(["self", "skills", "upload", "preview"]))

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "request_body_too_large" })
    // Web Streams 可在构造后预拉一个 chunk；Content-Length 守卫不得继续消费请求体。
    expect(pulls).toBeLessThanOrEqual(1)
    expect(fetchMock).toHaveBeenCalledOnce()
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
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie(), host: "site-a.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.headers.get("set-cookie")).toBeNull()
    expect(res.headers.get("location")).toBeNull()
  })
})
