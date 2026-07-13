// 价格/购买客户端（PAY-2）：经同源 `/api/billing` BFF 代理到 kokoro-payment 的 storefront 面
// （BFF 从密封信封派生 site_id/teamId，注入 web-bff caller 凭据）。入站过 Zod（payment 属外部边界）；
// 失败类型化上抛。诚实态优先：checkout 未开通（provider 未配置）由后端 501 驱动，绝不放假按钮。

import { z } from "zod"

// 套餐目录条目（storefront 子集）：金额/积分全程 BigInt 字符串（不过 Number 丢精度）。
export const planCatalogEntrySchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    name: z.string().min(1),
    currency: z.string().min(1),
    amount_minor: z.string().min(1),
    credit_micros: z.string().min(1),
    billing_interval: z.enum(["once", "month", "year"]),
  })
  .strict()
export type PlanCatalogEntry = z.infer<typeof planCatalogEntrySchema>

export const planCatalogSchema = z
  .object({ plans: z.array(planCatalogEntrySchema) })
  .strict()
export type PlanCatalog = z.infer<typeof planCatalogSchema>

// checkout 结果：ok=拿到 provider 跳转 URL（provider 已配置时）；unavailable=支付渠道未开通（501 诚实态）；
// unauthenticated=未登录（购买要求登录）。展示层据此决定跳转 / 禁用按钮 + 联系站点文案。
export type CheckoutResult =
  | { status: "ok"; checkout_url: string }
  | { status: "unavailable" }
  | { status: "unauthenticated" }

export type PricingFailureReason = "network" | "http" | "parse" | "not_configured"

export class PricingClientError extends Error {
  readonly reason: PricingFailureReason
  readonly status: number | null

  constructor(reason: PricingFailureReason, message: string, status: number | null) {
    super(message)
    this.name = "PricingClientError"
    this.reason = reason
    this.status = status
  }
}

const PLANS_PATH = "/api/billing/plans"
const CHECKOUT_PATH = "/api/billing/checkout"

const checkoutOkSchema = z.object({ checkout_url: z.string().min(1) }).strict()

function describeUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type PricingClient = {
  // 在售套餐目录；payment 未配置（预览档）→ not_configured 错误，展示层据此显示未开通态。
  plans: () => Promise<PlanCatalog>
  // 发起购买：诚实态——未开通（501）返回 unavailable，未登录（401）返回 unauthenticated，绝不假成功。
  checkout: (planId: string) => Promise<CheckoutResult>
}

export function createPricingClient(): PricingClient {
  return {
    plans: async () => {
      let response: Response
      try {
        response = await fetch(PLANS_PATH, { cache: "no-store" })
      } catch (error) {
        throw new PricingClientError("network", describeUnknown(error), null)
      }
      if (response.status === 503) {
        throw new PricingClientError("not_configured", "payment not configured", 503)
      }
      if (!response.ok) {
        throw new PricingClientError("http", `plans request failed with status ${response.status}`, response.status)
      }
      let raw: unknown
      try {
        raw = await response.json()
      } catch (error) {
        throw new PricingClientError("parse", describeUnknown(error), response.status)
      }
      try {
        return planCatalogSchema.parse(raw)
      } catch (error) {
        throw new PricingClientError("parse", describeUnknown(error), response.status)
      }
    },

    checkout: async (planId) => {
      let response: Response
      try {
        response = await fetch(CHECKOUT_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ plan_id: planId }),
        })
      } catch (error) {
        throw new PricingClientError("network", describeUnknown(error), null)
      }
      // 诚实态：状态真来自后端。501=支付渠道未开通（provider 未配置）；401=未登录（购买要求登录）。
      if (response.status === 501) {
        return { status: "unavailable" }
      }
      if (response.status === 401) {
        return { status: "unauthenticated" }
      }
      if (!response.ok) {
        throw new PricingClientError("http", `checkout failed with status ${response.status}`, response.status)
      }
      let raw: unknown
      try {
        raw = await response.json()
      } catch (error) {
        throw new PricingClientError("parse", describeUnknown(error), response.status)
      }
      try {
        return { status: "ok", checkout_url: checkoutOkSchema.parse(raw).checkout_url }
      } catch (error) {
        throw new PricingClientError("parse", describeUnknown(error), response.status)
      }
    },
  }
}
