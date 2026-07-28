"use client"

// Site-scoped 套餐目录：只读展示套餐、价格与积分信息。目录经 `/api/billing/plans` BFF 拉取；
// Web 不提供购买、支付跳转或兑换写能力。金额/积分全程 BigInt 换算展示（不过 Number 丢精度）。

import { useCallback } from "react"

import { formatMicros, formatMinor } from "@/billing/format"
import { planIntervalKey } from "@/billing/rules"
import type { PlanCatalogEntry, PricingClient } from "@/billing/pricing"
import { PricingClientError } from "@/billing/pricing"
import { useT } from "@/i18n/context"
import { useResource } from "@/lib/query"

import styles from "./pricing-panel.module.css"

// 套餐目录查询键（单发只读）。
const CATALOG_KEY = "billing/plans"

type CatalogState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unavailable" }
  | { kind: "ready"; plans: PlanCatalogEntry[] }

type PricingPanelProps = {
  client: PricingClient
  onClose: () => void
}

export function PricingPanel({ client, onClose }: PricingPanelProps) {
  const t = useT()
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("pricing.title")}
        className={styles.panel}
        data-testid="pricing-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{t("pricing.title")}</h2>
          <button type="button" className={styles.close} aria-label={t("pricing.close")} onClick={onClose}>
            ×
          </button>
        </header>
        <PricingContent client={client} />
      </div>
    </div>
  )
}

type PricingContentProps = {
  client: PricingClient
}

export function PricingContent({ client }: PricingContentProps) {
  const t = useT()
  // 目录经查询层单发读；payment 未配置（not_configured）→ 目录不可用，其余失败=加载错误。
  const catalogRes = useResource<PlanCatalogEntry[]>(
    CATALOG_KEY,
    useCallback(async () => (await client.plans()).plans, [client]),
  )
  const catalog: CatalogState =
    catalogRes.data !== undefined
      ? { kind: "ready", plans: catalogRes.data }
      : catalogRes.error !== undefined
        ? catalogRes.error instanceof PricingClientError && catalogRes.error.reason === "not_configured"
          ? { kind: "unavailable" }
          : { kind: "error" }
        : { kind: "loading" }
  return (
    <div className={styles.body}>
          {catalog.kind === "loading" ? (
            <p className={styles.hint}>{t("pricing.loading")}</p>
          ) : catalog.kind === "error" ? (
            <p className={styles.hint}>{t("pricing.empty")}</p>
          ) : catalog.kind === "unavailable" ? (
            <p className={styles.unavailable} role="alert">
              {t("pricing.unavailable")}
            </p>
          ) : catalog.plans.length === 0 ? (
            <p className={styles.hint}>{t("pricing.empty")}</p>
          ) : (
            <ul className={styles.grid}>
              {catalog.plans.map((plan) => (
                <li key={plan.id} className={styles.card} data-testid="pricing-card">
                  <span className={styles.cardName}>{plan.name}</span>
                  <div className={styles.price}>
                    <span className={styles.priceAmount}>{formatMinor(plan.amount_minor)}</span>
                    <span className={styles.priceMeta}>
                      {plan.currency} · {t(planIntervalKey(plan.billing_interval))}
                    </span>
                  </div>
                  <ul className={styles.benefits}>
                    <li className={styles.benefit}>
                      {t("pricing.credits", { credits: formatMicros(plan.credit_micros) })}
                    </li>
                  </ul>
                </li>
              ))}
            </ul>
          )}
    </div>
  )
}
