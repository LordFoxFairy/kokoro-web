// Site-scoped 套餐目录客户端：经同源 `/api/billing/plans` BFF 读取 kokoro-payment 的目录面。
// 浏览器只得到只读目录；Web 不暴露 checkout、支付或兑换写能力。入站过 Zod，失败类型化上抛。

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

function describeUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type PricingClient = {
  // Site-scoped 套餐目录；payment 未配置（预览档）→ not_configured，展示层显示目录不可用。
  plans: () => Promise<PlanCatalog>
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
  }
}
