// Acquisition shutdown：价格客户端只读 Site-scoped 套餐目录，不暴露 checkout/redeem 假能力。
import { afterEach, describe, expect, it, vi } from "vitest"

import { createPricingClient, PricingClientError } from "@/billing/pricing"

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("PricingClient.plans", () => {
  it("只暴露只读 plans 能力", () => {
    expect(Object.keys(createPricingClient())).toEqual(["plans"])
  })

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
