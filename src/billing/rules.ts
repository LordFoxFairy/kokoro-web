// 计费面业务规则判定（纯规则，零 React 零 I/O）：402 余额不足判定 / 套餐计费周期 → 文案 key。
// 金额十进制换算另见 format.ts。UI 只消费这些谓词/映射，不在组件内散写错误码与周期分支。

import type { PlanCatalogEntry } from "./pricing"
import { CREDIT_INSUFFICIENT } from "./client"
import type { MessageKey } from "@/i18n/messages"

// run 被 credit_insufficient 拒（session 受理挂点余额不足 → 402）：错误码由 client 从错误体取出、
// 落在 machine.error。据此给计费专用说明 + 价格入口（不复用通用失败文案）。null/其它码=非 402。
export function isCreditInsufficient(errorCode: string | null): boolean {
  return errorCode === CREDIT_INSUFFICIENT
}

// 套餐计费周期 → 本地化文案 key（一次性 / 月 / 年）。
export function planIntervalKey(interval: PlanCatalogEntry["billing_interval"]): MessageKey {
  switch (interval) {
    case "once":
      return "pricing.intervalOnce"
    case "month":
      return "pricing.intervalMonth"
    case "year":
      return "pricing.intervalYear"
  }
}
