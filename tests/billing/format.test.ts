import { describe, expect, it } from "vitest"

import { formatMicros, formatSignedMicros, microSign } from "@/billing/format"

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
