"use client"

// 计费面板（WEB-BILLING）：余额卡（余额/冻结）+ 流水列表（±着色、reason 本地化、滚动翻页）。
// 金额全程 BigInt 换算展示（不过 Number 丢精度）。billing off 档 → 零额空流水（session 不 503）。
// PAY-2 前不放假充值按钮：只读余额与流水，充值入口留白。

import { useCallback, useEffect, useState } from "react"

import type { BillingLedgerEntry, BillingSummary } from "@/contract/http"
import { formatMicros, formatSignedMicros, microSign } from "@/billing/format"
import type { BillingClient } from "@/billing/client"
import { useT } from "@/i18n/context"
import { useResource } from "@/lib/query"
import type { MessageKey } from "@/i18n/messages"

import styles from "./billing-panel.module.css"

// 余额卡查询键（单发可缓存读）。流水为分页累加，保留本地 accumulator（同 use-session-list 范式）。
const SUMMARY_KEY = "billing/summary"

type SummaryState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; summary: BillingSummary }

type LedgerState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: BillingLedgerEntry[]; cursor: string | undefined; loadingMore: boolean }

type BillingPanelProps = {
  client: BillingClient
  onClose: () => void
  // PAY-2：余额卡下的「查看套餐」购买入口（原充值入口留白位）；缺省不渲染（兼容未接 payment 的档）。
  onOpenPricing?: () => void
}

// 已知 credit reason → 本地化 key；未知 reason 回退原文（绝不裸露 key，也不吞未知类别）。
function reasonKey(reason: string): MessageKey | null {
  switch (reason) {
    case "model_call":
      return "billing.reasonModelCall"
    case "tool_call":
      return "billing.reasonToolCall"
    case "subscription":
      return "billing.reasonSubscription"
    case "refund":
      return "billing.reasonRefund"
    case "manual_adjustment":
      return "billing.reasonAdjustment"
    default:
      return null
  }
}

type BillingContentProps = {
  client: BillingClient
  // PAY-2：余额卡下的「查看套餐」购买入口；缺省不渲染（兼容未接 payment 的档）。
  onOpenPricing?: () => void
}

export function BillingContent({ client, onOpenPricing }: BillingContentProps) {
  const t = useT()
  const [ledger, setLedger] = useState<LedgerState>({ kind: "loading" })

  // 余额卡经查询层单发读；ResourceResult 适配回既有判别式，渲染分支不变。
  const summaryRes = useResource<BillingSummary>(
    SUMMARY_KEY,
    useCallback(() => client.summary(), [client]),
  )
  const summary: SummaryState =
    summaryRes.data !== undefined
      ? { kind: "ready", summary: summaryRes.data }
      : summaryRes.error !== undefined
        ? { kind: "error" }
        : { kind: "loading" }

  const loadLedger = useCallback(async (): Promise<LedgerState> => {
    try {
      const page = await client.ledger()
      return { kind: "ready", entries: page.entries, cursor: page.next_cursor, loadingMore: false }
    } catch {
      return { kind: "error" }
    }
  }, [client])

  useEffect(() => {
    void loadLedger().then(setLedger)
  }, [loadLedger])

  const loadMore = useCallback(async () => {
    if (ledger.kind !== "ready" || ledger.cursor === undefined || ledger.loadingMore) {
      return
    }
    const cursor = ledger.cursor
    setLedger({ ...ledger, loadingMore: true })
    try {
      const page = await client.ledger(cursor)
      setLedger({
        kind: "ready",
        entries: [...ledger.entries, ...page.entries],
        cursor: page.next_cursor,
        loadingMore: false,
      })
    } catch {
      setLedger({ ...ledger, loadingMore: false })
    }
  }, [client, ledger])

  return (
    <div className={styles.body}>
          <section className={styles.balanceCard} data-testid="billing-balance">
            {summary.kind === "loading" ? (
              <p className={styles.hint}>{t("billing.loading")}</p>
            ) : summary.kind === "error" ? (
              <p className={styles.hint}>{t("billing.loadError")}</p>
            ) : (
              <>
                <div className={styles.balanceMain}>
                  <span className={styles.balanceLabel}>{t("billing.balance")}</span>
                  <span className={styles.balanceValue}>{formatMicros(summary.summary.balance_micros)}</span>
                </div>
                <div className={styles.balanceHeld}>
                  <span>{t("billing.held")}</span>
                  <span>{formatMicros(summary.summary.held_micros)}</span>
                </div>
              </>
            )}
          </section>

          {onOpenPricing ? (
            <button type="button" className={styles.more} onClick={onOpenPricing}>
              {t("billing.viewPricing")}
            </button>
          ) : null}

          <h3 className={styles.ledgerHead}>{t("billing.ledgerTitle")}</h3>
          {ledger.kind === "loading" ? (
            <p className={styles.hint}>{t("billing.loading")}</p>
          ) : ledger.kind === "error" ? (
            <p className={styles.hint}>{t("billing.loadError")}</p>
          ) : ledger.entries.length === 0 ? (
            <p className={styles.hint}>{t("billing.ledgerEmpty")}</p>
          ) : (
            <>
              <ul className={styles.ledger}>
                {ledger.entries.map((entry) => {
                  const key = reasonKey(entry.reason)
                  return (
                    <li key={entry.entry_id} className={styles.entry}>
                      <div className={styles.entryMain}>
                        <span className={styles.entryReason}>{key ? t(key) : entry.reason}</span>
                        <span className={styles.entryDate}>{formatDate(entry.created_at)}</span>
                      </div>
                      <span className={styles.entryDelta} data-sign={microSign(entry.delta_micros)}>
                        {formatSignedMicros(entry.delta_micros)}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {ledger.cursor !== undefined ? (
                <button
                  type="button"
                  className={styles.more}
                  disabled={ledger.loadingMore}
                  onClick={loadMore}
                >
                  {ledger.loadingMore ? t("billing.loading") : t("billing.loadMore")}
                </button>
              ) : null}
            </>
          )}
    </div>
  )
}

export function BillingPanel({ client, onClose, onOpenPricing }: BillingPanelProps) {
  const t = useT()

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("billing.title")}
        className={styles.panel}
        data-testid="billing-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{t("billing.title")}</h2>
          <button type="button" className={styles.close} aria-label={t("billing.close")} onClick={onClose}>
            ×
          </button>
        </header>

        <BillingContent client={client} onOpenPricing={onOpenPricing} />
      </div>
    </div>
  )
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleDateString()
}
