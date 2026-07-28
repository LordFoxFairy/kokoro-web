import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"
import { __clearSiteResolveCache } from "@/lib/server/site"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_BASE_URL: "http://site.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_PAYMENT_BASE_URL: "http://payment.test",
  KOKORO_HUB_BASE_URL: "http://hub.test",
  KOKORO_WEB_UPSTREAM_TIMEOUT_MS: "100",
  KOKORO_SITE_RESOLVE_TIMEOUT_MS: "100",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function sessionCookie(): string {
  return `kokoro_session=${sealEnvelope(
    {
      runtime_jwt: "rt.jwt.sig",
      access_exp: nowSec() + 3600,
      refresh_token: "rt-refresh",
      user_id: "u1",
      namespace: "team_1",
      site_id: "site-a",
      exp: nowSec() + 3600,
    },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )}`
}

function siteResponse(): Response {
  return Response.json({
    data: { context: { siteId: "site-a", brand: { name: "Site A", logoUrl: null, themeColor: null } } },
  })
}

function pendingResponse(init: RequestInit | undefined, capture: { signal: AbortSignal | null }): Promise<Response> {
  capture.signal = init?.signal ?? null
  return new Promise<Response>((_resolve, reject) => {
    capture.signal?.addEventListener("abort", () => reject(capture.signal?.reason), { once: true })
  })
}

async function expectGatewayTimeout(response: Response, signal: AbortSignal | null): Promise<void> {
  expect(response.status).toBe(504)
  expect(await response.json()).toEqual({ error: "upstream_timeout" })
  expect(signal).not.toBeNull()
  expect(signal!.aborted).toBe(true)
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

describe("User BFF upstream deadlines", () => {
  it("maps a Site resolver deadline to 504 before auth issuance", async () => {
    const capture: { signal: AbortSignal | null } = { signal: null }
    vi.stubGlobal("fetch", vi.fn((_target: URL | string, init?: RequestInit) => pendingResponse(init, capture)))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { POST } = await import("@/app/api/auth/magic-link/request/route")

    const response = await POST(
      new Request("https://site-a.example/api/auth/magic-link/request", {
        method: "POST",
        headers: { host: "site-a.example", origin: "https://site-a.example", "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      }),
    )

    await expectGatewayTimeout(response, capture.signal)
  })

  it("maps an Auth issuer deadline to 504", async () => {
    const capture: { signal: AbortSignal | null } = { signal: null }
    vi.stubGlobal(
      "fetch",
      vi.fn((target: URL | string, init?: RequestInit) =>
        target.toString().startsWith("http://site.test/") ? Promise.resolve(siteResponse()) : pendingResponse(init, capture),
      ),
    )
    const { POST } = await import("@/app/api/auth/magic-link/request/route")

    const response = await POST(
      new Request("https://site-a.example/api/auth/magic-link/request", {
        method: "POST",
        headers: { host: "site-a.example", origin: "https://site-a.example", "content-type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      }),
    )

    await expectGatewayTimeout(response, capture.signal)
  })

  it("maps a Payment catalogue deadline to 504", async () => {
    const capture: { signal: AbortSignal | null } = { signal: null }
    vi.stubGlobal(
      "fetch",
      vi.fn((target: URL | string, init?: RequestInit) =>
        target.toString().startsWith("http://site.test/") ? Promise.resolve(siteResponse()) : pendingResponse(init, capture),
      ),
    )
    const { GET } = await import("@/app/api/billing/plans/route")

    const response = await GET(
      new Request("https://site-a.example/api/billing/plans", {
        headers: { host: "site-a.example", cookie: sessionCookie() },
      }),
    )

    await expectGatewayTimeout(response, capture.signal)
  })

  it("maps a public shared-session deadline to 504", async () => {
    const capture: { signal: AbortSignal | null } = { signal: null }
    vi.stubGlobal("fetch", vi.fn((_target: URL | string, init?: RequestInit) => pendingResponse(init, capture)))
    const { GET } = await import("@/app/api/shared/[id]/route")

    const response = await GET(new Request("https://site-a.example/api/shared/share_1"), {
      params: Promise.resolve({ id: "share_1" }),
    })

    await expectGatewayTimeout(response, capture.signal)
  })

  it("maps an ordinary Hub deadline to 504", async () => {
    const capture: { signal: AbortSignal | null } = { signal: null }
    vi.stubGlobal(
      "fetch",
      vi.fn((target: URL | string, init?: RequestInit) =>
        target.toString().startsWith("http://site.test/") ? Promise.resolve(siteResponse()) : pendingResponse(init, capture),
      ),
    )
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const response = await GET(
      new Request("https://site-a.example/api/hub/self/skills/pool", {
        headers: { host: "site-a.example", cookie: sessionCookie() },
      }),
      { params: Promise.resolve({ path: ["self", "skills", "pool"] }) },
    )

    await expectGatewayTimeout(response, capture.signal)
  })

  it("maps an ordinary Team deadline to 504", async () => {
    const capture: { signal: AbortSignal | null } = { signal: null }
    vi.stubGlobal(
      "fetch",
      vi.fn((target: URL | string, init?: RequestInit) =>
        target.toString().startsWith("http://site.test/") ? Promise.resolve(siteResponse()) : pendingResponse(init, capture),
      ),
    )
    const { GET } = await import("@/app/api/team/[...path]/route")

    const response = await GET(
      new Request("https://site-a.example/api/team/me/teams", {
        headers: { host: "site-a.example", cookie: sessionCookie() },
      }),
      { params: Promise.resolve({ path: ["me", "teams"] }) },
    )

    await expectGatewayTimeout(response, capture.signal)
  })
})
