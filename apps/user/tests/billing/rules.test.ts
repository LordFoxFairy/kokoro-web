// 计费规则：402 余额不足判定（仅 credit_insufficient）；套餐周期 → 文案 key。
import { describe, expect, it } from "vitest"

import { CREDIT_INSUFFICIENT } from "@/billing/client"
import { isCreditInsufficient, planIntervalKey } from "@/billing/rules"

describe("isCreditInsufficient", () => {
  it("命中 credit_insufficient", () => {
    expect(isCreditInsufficient(CREDIT_INSUFFICIENT)).toBe(true)
  })

  it("其它码 / null 不命中", () => {
    expect(isCreditInsufficient("some_other_error")).toBe(false)
    expect(isCreditInsufficient(null)).toBe(false)
  })
})

describe("planIntervalKey", () => {
  it("一次性 / 月 / 年 各映射对应 key", () => {
    expect(planIntervalKey("once")).toBe("pricing.intervalOnce")
    expect(planIntervalKey("month")).toBe("pricing.intervalMonth")
    expect(planIntervalKey("year")).toBe("pricing.intervalYear")
  })
})
