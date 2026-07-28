// 计费面板组件测试：余额卡 BigInt 换算 + 流水 ±着色/reason 本地化 + 空态 + 翻页
// + B1 用量透视（配额行 / 余额走势 / 消费-入账筛选 / 低余额预警）。
// billing 客户端为注入 fake（不打网络）；新功能断言走 data-testid/role，不耦合译文。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ComponentType } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { BillingClient } from "@/billing/client"
import { LocaleProvider } from "@/i18n/context"
import { BillingPanel } from "@/ui/billing/billing-panel"

const LegacyBillingPanel = BillingPanel as ComponentType<React.ComponentProps<typeof BillingPanel> & {
  onOpenPricing?: () => void
}>

// 真实契约形状：summary 含 quota_micros/quota_period；ledger 分录含 balance_after_micros。
// created_at 为 epoch **毫秒**（credit getTime() 直透）。
const DAY_A = Date.UTC(2026, 0, 10, 3, 0, 0) // 2026-01-10
const DAY_B = Date.UTC(2026, 0, 11, 5, 0, 0) // 2026-01-11

function makeClient(overrides: Partial<BillingClient> = {}): BillingClient {
  return {
    summary: vi
      .fn()
      .mockResolvedValue({ balance_micros: "12500000", held_micros: "500000", quota_micros: null, quota_period: null }),
    ledger: vi.fn().mockResolvedValue({
      entries: [
        { entry_id: "e1", delta_micros: "-250000", balance_after_micros: "12500000", reason: "model_call", created_at: DAY_B, run_id: "run_abcdef123456" },
        { entry_id: "e2", delta_micros: "5000000", balance_after_micros: "12750000", reason: "top_up_custom", created_at: DAY_A },
      ],
      next_cursor: "cur_2",
    }),
    byModel: vi.fn().mockResolvedValue({ period_start: "2026-07-01T00:00:00.000Z", items: [] }),
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
  })

  it("colours ledger deltas by sign and localizes known reasons", async () => {
    renderPanel(makeClient())
    await screen.findByText("Model call")
    const debit = screen.getByText("-25")
    expect(debit.getAttribute("data-sign")).toBe("negative")
    const credit = screen.getByText("+500")
    expect(credit.getAttribute("data-sign")).toBe("positive")
    // 未知 reason 回退原文（不裸露 key）。
    expect(screen.getByText("top_up_custom")).toBeTruthy()
  })

  it("shows an empty state when there are no transactions", async () => {
    renderPanel(makeClient({ ledger: vi.fn().mockResolvedValue({ entries: [] }) }))
    await screen.findByTestId("billing-balance")
    // 空流水：无任一日期分组头（dayNet 不出现）。
    expect(screen.queryByText("Model call")).toBeNull()
  })

  it("paginates via next_cursor on load more", async () => {
    const ledger = vi
      .fn()
      .mockResolvedValueOnce({
        entries: [{ entry_id: "e1", delta_micros: "-250000", balance_after_micros: "12500000", reason: "model_call", created_at: DAY_A }],
        next_cursor: "cur_2",
      })
      .mockResolvedValueOnce({
        entries: [{ entry_id: "e2", delta_micros: "-100000", balance_after_micros: "12400000", reason: "tool_call", created_at: DAY_A }],
      })
    renderPanel(makeClient({ ledger }))
    await screen.findByText("Model call")
    fireEvent.click(screen.getByText("Load more"))
    await screen.findByText("Tool call")
    await waitFor(() => expect(ledger).toHaveBeenCalledWith("cur_2"))
  })

  // —— B1 用量透视 ——

  it("shows quota line only when a quota is set", async () => {
    renderPanel(makeClient())
    await screen.findByTestId("billing-balance")
    expect(screen.queryByTestId("billing-quota")).toBeNull()
    cleanup()

    renderPanel(
      makeClient({
        summary: vi
          .fn()
          .mockResolvedValue({ balance_micros: "12500000", held_micros: "0", quota_micros: "300000000", quota_period: "monthly" }),
      }),
    )
    const quota = await screen.findByTestId("billing-quota")
    // 300_000_000 / 10_000 = 30000 积分。
    expect(quota.textContent).toContain("30000")
  })

  it("renders balance trend sparkline when there are ≥2 entries", async () => {
    renderPanel(makeClient())
    await screen.findByTestId("billing-trend")
  })

  it("warns on low balance and hides the warning when balance is healthy", async () => {
    // 100_000 micros = 10 积分 < 50 积分阈值 → 预警。
    renderPanel(
      makeClient({
        summary: vi.fn().mockResolvedValue({ balance_micros: "100000", held_micros: "0", quota_micros: null, quota_period: null }),
      }),
    )
    await screen.findByTestId("billing-low-balance")
    cleanup()
    // 健康余额（1250 积分）→ 无预警。
    renderPanel(makeClient())
    await screen.findByTestId("billing-balance")
    expect(screen.queryByTestId("billing-low-balance")).toBeNull()
  })

  it("低余额只读告警不渲染购买入口，即使注入旧导航回调", async () => {
    const onOpenPricing = vi.fn()
    render(
      <LegacyBillingPanel
        client={makeClient({
          summary: vi
            .fn()
            .mockResolvedValue({ balance_micros: "100000", held_micros: "0", quota_micros: null, quota_period: null }),
        })}
        onClose={vi.fn()}
        onOpenPricing={onOpenPricing}
      />,
      { wrapper: LocaleProvider },
    )
    const warning = await screen.findByTestId("billing-low-balance")
    expect(warning.querySelector("button")).toBeNull()
    expect(onOpenPricing).not.toHaveBeenCalled()
  })

  it("filters to spend-only, hiding credit entries", async () => {
    renderPanel(makeClient())
    await screen.findByText("Model call")
    // 初始全部：入账条目（+500）可见。
    expect(screen.getByText("+500")).toBeTruthy()
    // 三个筛选 tab：全部 / 消费 / 入账 → 点「消费」（index 1）。
    const tabs = screen.getAllByRole("tab")
    expect(tabs).toHaveLength(3)
    fireEvent.click(tabs[1])
    // 入账条目隐去，仅消费（-25）留存。
    await waitFor(() => expect(screen.queryByText("+500")).toBeNull())
    expect(screen.getByText("-25")).toBeTruthy()
  })

  it("groups entries by day with a per-day net subtotal", async () => {
    renderPanel(makeClient())
    await screen.findByText("Model call")
    // 两条跨两天（DAY_A、DAY_B）→ 两个分组头。
    const dayHeads = screen.getAllByTestId("billing-day")
    expect(dayHeads).toHaveLength(2)
    // 每个组头带当日净额（data-sign 标注）。
    expect(dayHeads[0].querySelector("[data-sign]")).toBeTruthy()
  })
})
