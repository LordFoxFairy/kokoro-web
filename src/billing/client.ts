// 计费只读客户端：经同源 `/api/session` BFF 代理取 session 的 /billing/summary|/billing/ledger
// （session 从已验 namespace 派生账户、代理 credit 窄读）。入站过契约 Zod；失败类型化上抛。
// billing off 档 → session 回零额空流水（不 503），展示层照常渲染。

import { ZodError } from "zod"

import {
  billingByModelPath,
  billingByModelSchema,
  billingLedgerPath,
  billingLedgerSchema,
  billingSummaryPath,
  billingSummarySchema,
  type BillingByModel,
  type BillingLedger,
  type BillingSummary,
} from "@/contract/http"
import { SESSION_PROXY_BASE } from "@/engine/config"

// session 受理挂点余额不足时的 reject reason（→402）：run 被拒的稳定错误码，
// web 端据此在失败处给计费专用说明 + 价格/联系入口（PAY-2 前不放假充值）。
export const CREDIT_INSUFFICIENT = "credit_insufficient"

export type BillingFailureReason = "network" | "http" | "parse"

export class BillingClientError extends Error {
  readonly reason: BillingFailureReason
  readonly status: number | null

  constructor(reason: BillingFailureReason, message: string, status: number | null) {
    super(message)
    this.name = "BillingClientError"
    this.reason = reason
    this.status = status
  }
}

function describeUnknown(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function getJson<T>(path: string, parse: (raw: unknown) => T): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${SESSION_PROXY_BASE}${path}`, { cache: "no-store" })
  } catch (error) {
    throw new BillingClientError("network", describeUnknown(error), null)
  }
  if (!response.ok) {
    throw new BillingClientError("http", `billing request failed with status ${response.status}`, response.status)
  }
  let raw: unknown
  try {
    raw = await response.json()
  } catch (error) {
    throw new BillingClientError("parse", describeUnknown(error), response.status)
  }
  try {
    return parse(raw)
  } catch (error) {
    if (error instanceof ZodError) {
      throw new BillingClientError("parse", error.message, response.status)
    }
    throw error
  }
}

export type BillingClient = {
  summary: () => Promise<BillingSummary>
  // 分页：cursor 缺省=首页；服务端回 next_cursor（无=到底）。
  ledger: (cursor?: string) => Promise<BillingLedger>
  // 本周期按模型消费分解（B1d）：无账户/off 档→空清单。
  byModel: () => Promise<BillingByModel>
}

export function createBillingClient(): BillingClient {
  return {
    summary: () => getJson(billingSummaryPath(), (raw) => billingSummarySchema.parse(raw)),
    ledger: (cursor) => {
      const query = cursor !== undefined ? `?cursor=${encodeURIComponent(cursor)}` : ""
      return getJson(`${billingLedgerPath()}${query}`, (raw) => billingLedgerSchema.parse(raw))
    },
    byModel: () => getJson(billingByModelPath(), (raw) => billingByModelSchema.parse(raw)),
  }
}
