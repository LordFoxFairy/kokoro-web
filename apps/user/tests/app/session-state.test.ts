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

function sessionCookie(siteId = "site-a"): string {
  return `kokoro_session=${sealEnvelope(
    {
      runtime_jwt: "old.jwt.sig",
      access_exp: nowSec() + 60,
      refresh_token: "refresh-old",
      user_id: "user-1",
      namespace: "team-1",
      site_id: siteId,
      exp: nowSec() + 3600,
    },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )}`
}

function siteResponse(siteId: string): Response {
  return Response.json({
    data: { context: { siteId, brand: { name: siteId, logoUrl: null, themeColor: null } } },
  })
}

function refreshResponse(siteId: string): Response {
  return Response.json({
    data: {
      token: "new.jwt.sig",
      namespace: "team-1",
      site_id: siteId,
      refresh_token: "refresh-new",
      refresh_expires_at: new Date((nowSec() + 3600) * 1000).toISOString(),
    },
  })
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

describe("GET /api/auth/session-state", () => {
  it("refreshes a near-expiry Site-bound envelope and writes the rotated cookie", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : refreshResponse("site-a"),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/auth/session-state/route")

    const response = await GET(
      new Request("https://site-a.example/api/auth/session-state", {
        headers: { host: "site-a.example", cookie: sessionCookie() },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ state: "authenticated" })
    const setCookie = response.headers.get("set-cookie")
    expect(setCookie).not.toBeNull()
    expect(setCookie ?? "").toContain("kokoro_session=")
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://user.test/auth/refresh",
    ])
  })

  it("fails closed without a cookie when refresh returns another Site", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : refreshResponse("site-b"),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/auth/session-state/route")

    const response = await GET(
      new Request("https://site-a.example/api/auth/session-state", {
        headers: { host: "site-a.example", cookie: sessionCookie() },
      }),
    )

    expect(await response.json()).toEqual({ state: "anonymous" })
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://user.test/auth/refresh",
    ])
  })
})
