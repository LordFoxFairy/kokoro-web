import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"
import { __clearSiteResolveCache } from "@/lib/server/site"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_SITE_BASE_URL: "http://site.test",
  KOKORO_PAYMENT_BASE_URL: "http://payment.test",
  KOKORO_INTERNAL_SECRET_WEB_BFF: "svc-secret",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

function siteResponse(siteId: string): Response {
  return jsonResponse(200, {
    data: { context: { siteId, brand: { name: siteId, logoUrl: null, themeColor: null } } },
  })
}

function issuedSessionResponse(): Response {
  return jsonResponse(200, {
    data: {
      token: "runtime.jwt.signature",
      namespace: "team-1",
      refresh_token: "refresh-1",
      refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: "user-1" },
      team: { id: "team-1" },
    },
  })
}

function sessionCookie(siteId = "site-a"): string {
  const sealed = sealEnvelope(
    {
      runtime_jwt: "runtime.jwt.signature",
      access_exp: nowSec() + 3600,
      refresh_token: "refresh-1",
      user_id: "user-1",
      namespace: "team-1",
      site_id: siteId,
      exp: nowSec() + 86_400,
    },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )
  return `kokoro_session=${sealed}`
}

function requestedUrls(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([target]) => target.toString())
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

describe("production Host to Site admission", () => {
  it("does not request a magic link for an unknown Host", async () => {
    const fetchMock = vi.fn(async (target: URL | string) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return new Response("not found", { status: 404 })
      if (url.startsWith("http://user.test/")) {
        return jsonResponse(200, {
          data: { email: "user@example.com", expires_at: new Date(Date.now() + 600_000).toISOString() },
        })
      }
      throw new Error(`unexpected target: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { POST } = await import("@/app/api/auth/magic-link/request/route")

    const response = await POST(
      new Request("https://unknown.example/api/auth/magic-link/request", {
        method: "POST",
        headers: { host: "unknown.example", origin: "https://unknown.example", "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "site_unresolved" })
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(requestedUrls(fetchMock)).toEqual(["http://site.test/site-context/resolve?host=unknown.example"])
  })

  it("does not consume a magic link or issue an envelope for an unknown Host", async () => {
    const fetchMock = vi.fn(async (target: URL | string) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return new Response("not found", { status: 404 })
      if (url.startsWith("http://user.test/")) return issuedSessionResponse()
      throw new Error(`unexpected target: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { GET } = await import("@/app/api/auth/callback/route")

    const response = await GET(
      new Request("https://unknown.example/api/auth/callback?token=link-token", {
        headers: { host: "unknown.example", cookie: "kokoro_auth_nonce=device-nonce" },
      }),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get("location")).toBe("/?auth=link_unavailable")
    expect(response.headers.get("set-cookie") ?? "").not.toContain("kokoro_session=")
    expect(requestedUrls(fetchMock)).toEqual(["http://site.test/site-context/resolve?host=unknown.example"])
  })

  it("does not call the team-session issuer or replace the envelope when Site resolution is unavailable", async () => {
    const fetchMock = vi.fn(async (target: URL | string) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) throw new Error("site resolver unavailable")
      if (url.startsWith("http://user.test/")) return issuedSessionResponse()
      throw new Error(`unexpected target: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { POST } = await import("@/app/api/team/switch/route")

    const response = await POST(
      new Request("https://site-a.example/api/team/switch", {
        method: "POST",
        headers: {
          host: "site-a.example",
          origin: "https://site-a.example",
          cookie: sessionCookie(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ team_id: "team-2" }),
      }),
    )

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: "site_unresolved" })
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(requestedUrls(fetchMock)).toEqual(["http://site.test/site-context/resolve?host=site-a.example"])
  })
})

describe("GET /api/billing/plans Site binding", () => {
  it("does not call payment when a Site A envelope is presented on the resolved Site B Host", async () => {
    const fetchMock = vi.fn(async (target: URL | string) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-b")
      if (url.startsWith("http://payment.test/")) return jsonResponse(200, { data: { plans: [] } })
      throw new Error(`unexpected target: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/billing/plans/route")

    const response = await GET(
      new Request("https://site-b.example/api/billing/plans", {
        headers: { host: "site-b.example", cookie: sessionCookie("site-a") },
      }),
    )

    expect(response.status).toBe(404)
    expect(requestedUrls(fetchMock)).toEqual(["http://site.test/site-context/resolve?host=site-b.example"])
  })

  it("does not call payment for an unknown Host", async () => {
    const fetchMock = vi.fn(async (target: URL | string) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return new Response("not found", { status: 404 })
      if (url.startsWith("http://payment.test/")) return jsonResponse(200, { data: { plans: [] } })
      throw new Error(`unexpected target: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { GET } = await import("@/app/api/billing/plans/route")

    const response = await GET(
      new Request("https://unknown.example/api/billing/plans", {
        headers: { host: "unknown.example", cookie: sessionCookie("site-a") },
      }),
    )

    expect(response.status).toBe(404)
    expect(requestedUrls(fetchMock)).toEqual(["http://site.test/site-context/resolve?host=unknown.example"])
  })

  it("does not call payment while the Site resolver is unavailable", async () => {
    const fetchMock = vi.fn(async (target: URL | string) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) throw new Error("site resolver unavailable")
      if (url.startsWith("http://payment.test/")) return jsonResponse(200, { data: { plans: [] } })
      throw new Error(`unexpected target: ${url}`)
    })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { GET } = await import("@/app/api/billing/plans/route")

    const response = await GET(
      new Request("https://site-a.example/api/billing/plans", {
        headers: { host: "site-a.example", cookie: sessionCookie("site-a") },
      }),
    )

    expect(response.status).toBe(404)
    expect(requestedUrls(fetchMock)).toEqual(["http://site.test/site-context/resolve?host=site-a.example"])
  })
})
