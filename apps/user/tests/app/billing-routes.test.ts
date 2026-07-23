// PAY-2 BFF：/api/billing/plans（目录读面）+ /api/billing/checkout（收银台意图）。
// 断言：未登录 401、payment 未配置 503、site/team 从信封派生（浏览器无从伪造）、
// payment {data}+camelCase → web {plans}+snake_case、checkout 501 诚实态透传。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_PAYMENT_BASE_URL: "http://payment.test",
  KOKORO_INTERNAL_SECRET_WEB_BFF: "svc-secret",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function sessionCookie(): string {
  const sealed = sealEnvelope(
    { runtime_jwt: "rt.jwt.sig", access_exp: nowSec() + 3600, refresh_token: "rt-refresh", user_id: "u1", namespace: "team_1", site_id: "site-a", exp: nowSec() + 3600 },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )
  return `kokoro_session=${sealed}`
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe("GET /api/billing/plans", () => {
  it("注入 site_id（信封派生）+ web-bff 凭据，camelCase{data} → snake_case{plans}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        data: {
          plans: [
            { id: "p1", key: "studio", name: "Studio", currency: "USD", amountMinor: "4900", creditMicros: "1000000", billingInterval: "month" },
          ],
        },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/billing/plans/route")

    const res = await GET(new Request("http://localhost/api/billing/plans", { headers: { cookie: sessionCookie() } }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { plans: Array<Record<string, unknown>> }
    expect(body.plans).toEqual([
      { id: "p1", key: "studio", name: "Studio", currency: "USD", amount_minor: "4900", credit_micros: "1000000", billing_interval: "month" },
    ])

    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(target).toBe("http://payment.test/plans")
    const headers = init.headers as Headers
    expect(headers.get("x-kokoro-service")).toBe("web-bff")
    expect(headers.get("x-kokoro-internal-secret")).toBe("svc-secret")
    expect(headers.get("x-kokoro-site-id")).toBe("site-a")
  })

  it("未登录 → 401（不触达 payment）", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/billing/plans/route")
    const res = await GET(new Request("http://localhost/api/billing/plans"))
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("payment 未配置 → 503（预览档诚实态）", async () => {
    delete process.env.KOKORO_PAYMENT_BASE_URL
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/billing/plans/route")
    const res = await GET(new Request("http://localhost/api/billing/plans", { headers: { cookie: sessionCookie() } }))
    expect(res.status).toBe(503)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/billing/checkout", () => {
  it("site/team 从信封派生（浏览器 body 只带 plan_id，不接受伪造身份）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(501, { error: { code: "payment.checkout_unavailable" } }))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/billing/checkout/route")

    const res = await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { cookie: sessionCookie(), "content-type": "application/json", origin: "http://localhost", host: "localhost" },
        // 浏览器试图夹带 teamId/siteId：一律被无视，身份只从信封派生。
        body: JSON.stringify({ plan_id: "p1", teamId: "team_evil", siteId: "site-evil" }),
      }),
    )
    // 诚实态：payment 501 原样透传（支付渠道未开通）。
    expect(res.status).toBe(501)

    const [target, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(target).toBe("http://payment.test/orders/checkout")
    const sent = JSON.parse(init.body as string) as { teamId: string; planId: string }
    expect(sent).toEqual({ teamId: "team_1", planId: "p1" })
    const headers = init.headers as Headers
    expect(headers.get("x-kokoro-site-id")).toBe("site-a")
    expect(headers.get("x-kokoro-service")).toBe("web-bff")
  })

  it("未登录 → 401（购买要求登录，不触达 payment）", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/billing/checkout/route")
    const res = await POST(
      new Request("http://localhost/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" },
        body: JSON.stringify({ plan_id: "p1" }),
      }),
    )
    expect(res.status).toBe(401)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
