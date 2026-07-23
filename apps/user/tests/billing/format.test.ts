import { describe, expect, it } from "vitest"

import {
  formatCredits,
  formatMicros,
  formatMinor,
  formatSignedCredits,
  formatSignedMicros,
  microSign,
} from "@/billing/format"

describe("credit formatting (1 积分 = 10000 micros, BigInt safe)", () => {
  it("shifts micros to credits, trims trailing zeros", () => {
    expect(formatCredits("10000")).toBe("1") // 1 积分
    expect(formatCredits("80000")).toBe("8") // 8 积分
    expect(formatCredits("1000000")).toBe("100") // 100 积分
    expect(formatCredits("5000")).toBe("0.5") // 半积分碎屑
    expect(formatCredits("0")).toBe("0")
  })
  it("signs credits: + on positive, - on negative, none on zero", () => {
    expect(formatSignedCredits("50000")).toBe("+5")
    expect(formatSignedCredits("-250000")).toBe("-25")
    expect(formatSignedCredits("0")).toBe("0")
  })
  it("keeps BigInt precision + falls back to 0 on garbage", () => {
    expect(formatCredits("90071992547409930000")).toBe("9007199254740993")
    expect(formatCredits("not-a-number")).toBe("0")
  })
})

describe("micro-unit formatting (BigInt safe)", () => {
  it("shifts micros to units and trims trailing zeros", () => {
    expect(formatMicros("1000000")).toBe("1")
    expect(formatMicros("1500000")).toBe("1.5")
    expect(formatMicros("250000")).toBe("0.25")
    expect(formatMicros("1")).toBe("0.000001")
    expect(formatMicros("0")).toBe("0")
  })

  it("preserves precision beyond Number.MAX_SAFE_INTEGER (no float rounding)", () => {
    // 9_007_199_254_740_993 micros = 9_007_199_254.740993 units. Number(...) 会把这串舍成 ...992。
    const micros = "9007199254740993"
    expect(formatMicros(micros)).toBe("9007199254.740993")
    // 反证：过 Number 会丢末位精度。
    expect(String(Number(micros) / 1_000_000)).not.toBe("9007199254.740993")
  })

  it("handles negatives and signs", () => {
    expect(formatMicros("-250000")).toBe("-0.25")
    expect(microSign("-250000")).toBe("negative")
    expect(microSign("250000")).toBe("positive")
    expect(microSign("0")).toBe("zero")
    expect(formatSignedMicros("250000")).toBe("+0.25")
    expect(formatSignedMicros("-250000")).toBe("-0.25")
    expect(formatSignedMicros("0")).toBe("0")
  })

  it("falls back to 0 on malformed input instead of throwing", () => {
    expect(formatMicros("not-a-number")).toBe("0")
    expect(microSign("1.5")).toBe("zero")
  })
})

describe("minor-unit price formatting (PAY-2, BigInt safe)", () => {
  it("shifts minor units to 2-decimal amount", () => {
    expect(formatMinor("4900")).toBe("49.00")
    expect(formatMinor("9")).toBe("0.09")
    expect(formatMinor("0")).toBe("0.00")
    expect(formatMinor("100000")).toBe("1000.00")
  })

  it("keeps BigInt precision beyond Number range", () => {
    expect(formatMinor("900719925474099300")).toBe("9007199254740993.00")
  })

  it("falls back to 0 on malformed input instead of throwing", () => {
    expect(formatMinor("not-a-number")).toBe("0")
  })
})
