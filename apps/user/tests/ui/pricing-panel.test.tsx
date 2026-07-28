// Acquisition shutdown：套餐卡只读展示；无购买按钮、跳转或注入 checkout 能力。
import { cleanup, render, screen, waitFor } from "@testing-library/react"
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

type LegacyPricingClient = PricingClient & { checkout: ReturnType<typeof vi.fn> }

function makeClient(over: Partial<LegacyPricingClient> = {}): LegacyPricingClient {
  return {
    plans: async () => ({ plans: [PLAN] }),
    checkout: vi.fn(),
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

  it("套餐卡是只读信息，即使注入旧 checkout 能力也没有购买控件", async () => {
    const checkout = vi.fn()
    renderPanel(makeClient({ checkout }))
    const card = await screen.findByTestId("pricing-card")
    expect(card.querySelector("button")).toBeNull()
    expect(checkout).not.toHaveBeenCalled()
  })
})
