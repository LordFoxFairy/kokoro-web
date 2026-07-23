// PAY-2 价格面板：套餐卡渲染（价格/积分格式化）+ 诚实未开通态（catalog not_configured / checkout 501
// → 显式说明 + 禁用购买，绝不假成功）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { PricingClient } from "@/billing/pricing"
import { PricingClientError } from "@/billing/pricing"
import { LocaleProvider } from "@/i18n/context"
import { PricingPanel } from "@/ui/billing/pricing-panel"

const PLAN = {
  id: "p1",
  key: "studio",
  name: "Studio Bundle",
  currency: "USD",
  amount_minor: "4900",
  credit_micros: "1000000",
  billing_interval: "month" as const,
}

function makeClient(over: Partial<PricingClient> = {}): PricingClient {
  return {
    plans: async () => ({ plans: [PLAN] }),
    checkout: async () => ({ status: "unavailable" }),
    ...over,
  }
}

afterEach(cleanup)

function renderPanel(client: PricingClient) {
  render(<PricingPanel client={client} onClose={() => {}} />, { wrapper: LocaleProvider })
}

describe("PricingPanel", () => {
  it("渲染套餐卡：名称 + 价格（minor→十进制）+ 积分（micros→十进制）", async () => {
    renderPanel(makeClient())
    await screen.findByTestId("pricing-card")
    expect(screen.getByText("Studio Bundle")).toBeTruthy()
    expect(screen.getByText("49.00")).toBeTruthy()
    expect(screen.getByText(/1 credits/)).toBeTruthy()
  })

  it("catalog not_configured → 诚实未开通态（无套餐卡）", async () => {
    const client = makeClient({
      plans: async () => {
        throw new PricingClientError("not_configured", "payment not configured", 503)
      },
    })
    renderPanel(client)
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(screen.queryByTestId("pricing-card")).toBeNull()
  })

  it("购买 → checkout 501 → 显式未开通说明 + 购买按钮禁用（状态真来自后端）", async () => {
    const checkout = vi.fn(async () => ({ status: "unavailable" as const }))
    renderPanel(makeClient({ checkout }))
    const card = await screen.findByTestId("pricing-card")
    const buyBtn = card.querySelector("button")!
    fireEvent.click(buyBtn)
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(checkout).toHaveBeenCalledWith("p1")
    // 禁用态来自真实 501 响应，非预置假按钮。
    expect((card.querySelector("button") as HTMLButtonElement).disabled).toBe(true)
  })
})
