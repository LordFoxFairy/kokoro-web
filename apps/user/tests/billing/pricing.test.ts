// PAY-2 价格/购买客户端：目录 Zod 校验、checkout 诚实态映射（501→unavailable / 401→unauthenticated）。
import { afterEach, describe, expect, it, vi } from "vitest"

import { createPricingClient, PricingClientError } from "@/billing/pricing"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("PricingClient.plans", () => {
  it("过 Zod 校验返回目录", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          plans: [
            { id: "p1", key: "studio", name: "Studio", currency: "USD", amount_minor: "4900", credit_micros: "1000000", billing_interval: "month" },
          ],
        }),
      ),
    )
    const catalog = await createPricingClient().plans()
    expect(catalog.plans[0]).toMatchObject({ id: "p1", amount_minor: "4900", billing_interval: "month" })
  })

  it("payment 未配置（503）→ not_configured 错误（展示层据此显示未开通态）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503, { error: "payment_not_configured" })))
    await expect(createPricingClient().plans()).rejects.toMatchObject({ reason: "not_configured" })
  })

  it("形状不符 → parse 错误（零静默降级）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { plans: [{ id: "p1" }] })))
    await expect(createPricingClient().plans()).rejects.toBeInstanceOf(PricingClientError)
  })
})

describe("PricingClient.checkout（诚实态）", () => {
  it("501 → unavailable（支付渠道未开通，禁用购买）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(501, { error: "checkout_unavailable" })))
    expect(await createPricingClient().checkout("p1")).toEqual({ status: "unavailable" })
  })

  it("401 → unauthenticated（购买要求登录）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "unauthenticated" })))
    expect(await createPricingClient().checkout("p1")).toEqual({ status: "unauthenticated" })
  })

  it("200 → ok + checkout_url（provider 已配置的跳转）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { checkout_url: "https://pay.example/session/xyz" })))
    expect(await createPricingClient().checkout("p1")).toEqual({ status: "ok", checkout_url: "https://pay.example/session/xyz" })
  })

  it("提交 body 只带 plan_id（身份轴不由浏览器携带）", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(501, { error: "checkout_unavailable" }))
    vi.stubGlobal("fetch", fetchMock)
    await createPricingClient().checkout("p1")
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ plan_id: "p1" })
  })
})
