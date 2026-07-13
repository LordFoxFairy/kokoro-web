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
