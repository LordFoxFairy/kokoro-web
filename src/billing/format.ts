// 计费金额格式化：金额恒为「微单位」整数字符串（1 单位 = 1_000_000 微单位）。全程 BigInt——
// 绝不过 Number（余额可能远超 2^53，浮点会丢精度）。展示换算只做十进制移位，不引入货币符号
// （币种/符号由未来 PAY 档决定，这里只给稳定的十进制数字串）。

// tsconfig target 早于 ES2020，不能用 n 字面量；用 BigInt() 构造。
const ZERO = BigInt(0)
const MICROS_PER_UNIT = BigInt(1_000_000)
const FRACTION_DIGITS = 6

export type MicroSign = "positive" | "negative" | "zero"

// 微单位字符串 → 展示用十进制串（BigInt 安全）。去尾零，负号前置，至少保留整数位。
// 非法输入（空/含非数字）回退 "0"，绝不抛（展示层不因脏数据崩）。
export function formatMicros(micros: string): string {
  let value: bigint
  try {
    value = BigInt(micros)
  } catch {
    return "0"
  }
  const negative = value < ZERO
  const abs = negative ? -value : value
  const whole = abs / MICROS_PER_UNIT
  const fraction = abs % MICROS_PER_UNIT
  let out = whole.toString()
  if (fraction > ZERO) {
    const frac = fraction.toString().padStart(FRACTION_DIGITS, "0").replace(/0+$/, "")
    out = `${out}.${frac}`
  }
  return negative ? `-${out}` : out
}

// 用户面单位：积分（credit）。1 积分 = 10_000 micros（与 kokoro-credit domain/amount + PRD 一致）。
// 展示按此移位（4 位小数），去尾零——整积分显示整数，含碎屑显示小数。BigInt 安全，非法回退 "0"。
const MICROS_PER_CREDIT = BigInt(10_000)
const CREDIT_FRACTION_DIGITS = 4

export function formatCredits(micros: string): string {
  let value: bigint
  try {
    value = BigInt(micros)
  } catch {
    return "0"
  }
  const negative = value < ZERO
  const abs = negative ? -value : value
  const whole = abs / MICROS_PER_CREDIT
  const fraction = abs % MICROS_PER_CREDIT
  let out = whole.toString()
  if (fraction > ZERO) {
    const frac = fraction.toString().padStart(CREDIT_FRACTION_DIGITS, "0").replace(/0+$/, "")
    out = `${out}.${frac}`
  }
  return negative ? `-${out}` : out
}

// 微单位 → 积分数值（Number）。**仅供图表几何**（sparkline 相对定位）——绝不用于精算/展示金额
// （精算走 BigInt 的 formatCredits）。用户余额量级远低于 2^53 积分，图表用途下精度足够。非法回退 0。
export function creditsToNumber(micros: string): number {
  try {
    return Number(BigInt(micros)) / 10_000
  } catch {
    return 0
  }
}

// 带符号积分展示（流水条目）：正数前置「+」，负数自带「-」，零不加号。
export function formatSignedCredits(micros: string): string {
  const formatted = formatCredits(micros)
  return microSign(micros) === "positive" ? `+${formatted}` : formatted
}

// 金额正负（着色/加号用）：BigInt 判定，零单列。
export function microSign(micros: string): MicroSign {
  let value: bigint
  try {
    value = BigInt(micros)
  } catch {
    return "zero"
  }
  if (value > ZERO) return "positive"
  if (value < ZERO) return "negative"
  return "zero"
}

// 带符号展示（流水条目）：正数前置「+」，负数由 formatMicros 自带「-」，零不加号。
export function formatSignedMicros(micros: string): string {
  const formatted = formatMicros(micros)
  return microSign(micros) === "positive" ? `+${formatted}` : formatted
}

// 套餐定价（PAY-2）：金额恒为「最小货币单位」整数字符串（1 单位 = 100 分位，如 cents）。全程 BigInt——
// 十进制移位保留两位小数（V1 通用档，零小数币种如 JPY 的精修归后续）；非法输入回退 "0"，绝不抛。
const MINOR_PER_UNIT = BigInt(100)

export function formatMinor(minor: string): string {
  let value: bigint
  try {
    value = BigInt(minor)
  } catch {
    return "0"
  }
  const negative = value < ZERO
  const abs = negative ? -value : value
  const whole = abs / MINOR_PER_UNIT
  const fraction = abs % MINOR_PER_UNIT
  const frac = fraction.toString().padStart(2, "0")
  const out = `${whole.toString()}.${frac}`
  return negative ? `-${out}` : out
}
