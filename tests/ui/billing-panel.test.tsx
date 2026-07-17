// 计费面板组件测试：余额卡 BigInt 换算 + 流水 ±着色/reason 本地化 + 空态 + 翻页。
// billing 客户端为注入 fake（不打网络）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { BillingClient } from "@/billing/client"
import { LocaleProvider } from "@/i18n/context"
import { BillingPanel } from "@/ui/billing/billing-panel"

function makeClient(overrides: Partial<BillingClient> = {}): BillingClient {
  return {
    summary: vi.fn().mockResolvedValue({ balance_micros: "12500000", held_micros: "500000" }),
    ledger: vi.fn().mockResolvedValue({
      entries: [
        { entry_id: "e1", delta_micros: "-250000", reason: "model_call", created_at: 1_700_000_000, run_id: "run_1" },
        { entry_id: "e2", delta_micros: "5000000", reason: "top_up_custom", created_at: 1_700_000_100 },
      ],
      next_cursor: "cur_2",
    }),
    ...overrides,
  }
}

function renderPanel(client: BillingClient) {
  return render(<BillingPanel client={client} onClose={vi.fn()} />, { wrapper: LocaleProvider })
}

afterEach(cleanup)

describe("BillingPanel", () => {
  it("renders balance and held in credits (1 积分 = 10000 micros)", async () => {
    renderPanel(makeClient())
    const balance = await screen.findByTestId("billing-balance")
    // 12_500_000 micros / 10_000 = 1250 积分；500_000 / 10_000 = 50 积分。
    expect(balance.textContent).toContain("1250")
    expect(balance.textContent).toContain("50")
    expect(balance.textContent).toContain("积分")
  })

  it("colours ledger deltas by sign and localizes known reasons", async () => {
    renderPanel(makeClient())
    await screen.findByText("Model call")
    // -250_000 / 10_000 = -25；5_000_000 / 10_000 = +500。
    const debit = screen.getByText("-25")
    expect(debit.getAttribute("data-sign")).toBe("negative")
    const credit = screen.getByText("+500")
    expect(credit.getAttribute("data-sign")).toBe("positive")
    // 未知 reason 回退原文（不裸露 key）。
    expect(screen.getByText("top_up_custom")).toBeTruthy()
  })

  it("shows an empty state when there are no transactions", async () => {
    renderPanel(makeClient({ ledger: vi.fn().mockResolvedValue({ entries: [] }) }))
    await screen.findByText("No transactions yet")
  })

  it("paginates via next_cursor on load more", async () => {
    const ledger = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [{ entry_id: "e1", delta_micros: "-250000", reason: "model_call", created_at: 1_700_000_000 }],
        next_cursor: "cur_2",
      })
      .mockResolvedValueOnce({
        entries: [{ entry_id: "e2", delta_micros: "-100000", reason: "tool_call", created_at: 1_700_000_200 }],
      })
    renderPanel(makeClient({ ledger }))
    await screen.findByText("Model call")
    fireEvent.click(screen.getByText("Load more"))
    await screen.findByText("Tool call")
    await waitFor(() => expect(ledger).toHaveBeenCalledWith("cur_2"))
  })
})
