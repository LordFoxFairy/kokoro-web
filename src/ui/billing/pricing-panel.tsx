"use client"

// 价格/购买面板（PAY-2）：套餐卡（权益列表 + 价格 + 购买按钮）。目录经 `/api/billing/plans` BFF 拉取
// （site/owner 从信封派生）。诚实态优先：payment 未配置 / checkout 501 → 显式「支付暂未开通」+ 禁用购买，
// 状态真来自后端，绝不放假按钮。金额/积分全程 BigInt 换算展示（不过 Number 丢精度）。

import { useCallback, useEffect, useState } from "react"

import { formatMicros, formatMinor } from "@/billing/format"
import type { PlanCatalogEntry, PricingClient } from "@/billing/pricing"
import { PricingClientError } from "@/billing/pricing"
import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"

import styles from "./pricing-panel.module.css"

type CatalogState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "unavailable" }
  | { kind: "ready"; plans: PlanCatalogEntry[] }

type PricingPanelProps = {
  client: PricingClient
  onClose: () => void
}

function intervalKey(interval: PlanCatalogEntry["billing_interval"]): MessageKey {
  switch (interval) {
    case "once":
      return "pricing.intervalOnce"
    case "month":
      return "pricing.intervalMonth"
    case "year":
      return "pricing.intervalYear"
  }
}

export function PricingPanel({ client, onClose }: PricingPanelProps) {
  const t = useT()
  const [catalog, setCatalog] = useState<CatalogState>({ kind: "loading" })
  // 购买诚实态（来自后端 checkout 响应）：unavailable=501 未开通（禁用购买）；login=401 未登录。
  const [purchaseNotice, setPurchaseNotice] = useState<"none" | "unavailable" | "login">("none")
  const [pendingPlan, setPendingPlan] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void client
      .plans()
      .then((catalogResult) => {
        if (live) setCatalog({ kind: "ready", plans: catalogResult.plans })
      })
      .catch((error: unknown) => {
        if (!live) return
        // payment 未配置（预览档 / 未接服务）→ 诚实未开通态；其余失败=加载错误。
        setCatalog(error instanceof PricingClientError && error.reason === "not_configured"
          ? { kind: "unavailable" }
          : { kind: "error" })
      })
    return () => {
      live = false
    }
  }, [client])

  const buy = useCallback(
    async (planId: string) => {
      setPendingPlan(planId)
      setPurchaseNotice("none")
      try {
        const result = await client.checkout(planId)
        if (result.status === "ok") {
          // provider 已配置：跳转 provider 托管收银台（V1 无 provider，此路径暂不可达）。
          window.location.assign(result.checkout_url)
          return
        }
        // 诚实态：状态真来自后端。501=未开通（禁用后续购买）；401=未登录。
        setPurchaseNotice(result.status === "unavailable" ? "unavailable" : "login")
      } catch {
        setPurchaseNotice("unavailable")
      } finally {
        setPendingPlan(null)
      }
    },
    [client],
  )

  const checkoutBlocked = purchaseNotice === "unavailable"

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

        <div className={styles.body}>
          {purchaseNotice === "unavailable" ? (
            <p className={styles.unavailable} role="alert">
              {t("pricing.unavailable")}
            </p>
          ) : purchaseNotice === "login" ? (
            <p className={styles.unavailable} role="alert">
              {t("pricing.loginRequired")}
            </p>
          ) : null}

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
                      {plan.currency} · {t(intervalKey(plan.billing_interval))}
                    </span>
                  </div>
                  <ul className={styles.benefits}>
                    <li className={styles.benefit}>
                      {t("pricing.credits", { credits: formatMicros(plan.credit_micros) })}
                    </li>
                  </ul>
                  <button
                    type="button"
                    className={styles.buy}
                    disabled={checkoutBlocked || pendingPlan !== null}
                    onClick={() => void buy(plan.id)}
                  >
                    {checkoutBlocked
                      ? t("pricing.buyUnavailable")
                      : pendingPlan === plan.id
                        ? t("pricing.buying")
                        : t("pricing.buy")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
