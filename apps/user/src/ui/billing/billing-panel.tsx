"use client"

// 计费面板（WEB-BILLING + B1 用量透视）：低余额预警条 + 余额卡（余额/冻结/配额）+ 余额走势
// sparkline + 流水（按天分组、消费/入账筛选、run 标记、±着色）。金额全程 BigInt 换算展示
// （sparkline 几何除外，见 creditsToNumber）。billing off 档 → 零额空流水（session 不 503）。

import { useCallback, useEffect, useMemo, useState } from "react"

import type { BillingByModel, BillingLedgerEntry, BillingSummary } from "@/contract/http"
import { creditsToNumber, formatCredits, formatSignedCredits, microSign } from "@/billing/format"
import type { BillingClient } from "@/billing/client"
import { useT } from "@/i18n/context"
import { useResource } from "@/lib/query"
import type { MessageKey } from "@/i18n/messages"

import styles from "./billing-panel.module.css"

// 余额卡查询键（单发可缓存读）。流水为分页累加，保留本地 accumulator（同 use-session-list 范式）。
const SUMMARY_KEY = "billing/summary"
// 按模型消费分解查询键（B1d，单发可缓存读）。
const BY_MODEL_KEY = "billing/by-model"

// 低余额阈值：可用余额低于此值 → 顶部预警条引导充值。50 积分 = 500_000 微单位。
const LOW_BALANCE_MICROS = BigInt(500_000)
const EMPTY_LEDGER_ENTRIES: BillingLedgerEntry[] = []

type SummaryState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; summary: BillingSummary }

type LedgerState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; entries: BillingLedgerEntry[]; cursor: string | undefined; loadingMore: boolean }

// 流水筛选：全部 / 仅消费（delta<0）/ 仅入账（delta>0）。
type LedgerFilter = "all" | "spend" | "credit"

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

// 配额周期 → 本地化 key（credit domain 现仅 "monthly"）；未知回退 null（只显额度不显周期）。
function quotaPeriodKey(period: string): MessageKey | null {
  return period === "monthly" ? "billing.quotaPeriodMonthly" : null
}

function isLowBalance(balanceMicros: string): boolean {
  try {
    return BigInt(balanceMicros) < LOW_BALANCE_MICROS
  } catch {
    return false
  }
}

// created_at 为 epoch **毫秒**（credit getTime() 直透）。日期键（本地 YYYY-MM-DD，用于分组）。
function dayKey(epochMs: number): string {
  const d = new Date(epochMs)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function formatDay(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString()
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

// 按天分组（保序：entries 已 newest-first）：每组带当日净额（delta 求和，BigInt）。
type LedgerDay = { key: string; label: string; net: string; entries: BillingLedgerEntry[] }

function groupByDay(entries: BillingLedgerEntry[]): LedgerDay[] {
  const days: LedgerDay[] = []
  const index = new Map<string, LedgerDay>()
  for (const entry of entries) {
    const key = dayKey(entry.created_at)
    let day = index.get(key)
    if (day === undefined) {
      day = { key, label: formatDay(entry.created_at), net: "0", entries: [] }
      index.set(key, day)
      days.push(day)
    }
    day.entries.push(entry)
    try {
      day.net = (BigInt(day.net) + BigInt(entry.delta_micros)).toString()
    } catch {
      // 脏 delta 不参与求和（展示层不因单条脏数据崩）。
    }
  }
  return days
}

// 余额走势 sparkline：入账后余额（chronological）折线。等值/单点退化为水平线，仍给视觉锚。
function BalanceSparkline({ values }: { values: number[] }): React.JSX.Element | null {
  if (values.length < 2) {
    return null
  }
  const W = 100
  const H = 28
  const PAD = 2
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const stepX = (W - PAD * 2) / (values.length - 1)
  const points = values
    .map((v, i) => {
      const x = PAD + i * stepX
      const y = PAD + (H - PAD * 2) * (1 - (v - min) / span)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")
  return (
    <svg className={styles.sparkline} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <polyline points={points} fill="none" />
    </svg>
  )
}

type BillingContentProps = {
  client: BillingClient
  // PAY-2：余额卡下的「查看套餐」购买入口；缺省不渲染（兼容未接 payment 的档）。
  onOpenPricing?: () => void
}

export function BillingContent({ client, onOpenPricing }: BillingContentProps) {
  const t = useT()
  const [ledger, setLedger] = useState<LedgerState>({ kind: "loading" })
  const [filter, setFilter] = useState<LedgerFilter>("all")

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

  // B1d 按模型消费分解（本月）：单发缓存读；无账户/off 档→空清单（不渲染区块）。
  const byModelRes = useResource<BillingByModel>(
    BY_MODEL_KEY,
    useCallback(() => client.byModel(), [client]),
  )
  const byModelItems = byModelRes.data?.items ?? []
  const byModelMax = byModelItems.reduce((m, it) => Math.max(m, creditsToNumber(it.spent_micros)), 0)

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

  const allEntries = ledger.kind === "ready" ? ledger.entries : EMPTY_LEDGER_ENTRIES

  // 余额走势：入账后余额（chronological）——entries newest-first,故 reverse。
  const trend = useMemo(
    () => allEntries.map((e) => creditsToNumber(e.balance_after_micros)).reverse(),
    [allEntries],
  )

  const filtered = useMemo(() => {
    if (filter === "all") return allEntries
    const want = filter === "spend" ? "negative" : "positive"
    return allEntries.filter((e) => microSign(e.delta_micros) === want)
  }, [allEntries, filter])

  const days = useMemo(() => groupByDay(filtered), [filtered])

  const lowBalance = summary.kind === "ready" && isLowBalance(summary.summary.balance_micros)

  return (
    <div className={styles.body}>
      {/* B1c 低余额预警：可用余额低于阈值即引导充值（有购买入口时才给按钮）。 */}
      {lowBalance ? (
        <section className={styles.lowBalance} data-testid="billing-low-balance">
          <div className={styles.lowBalanceText}>
            <strong className={styles.lowBalanceTitle}>{t("billing.lowBalanceTitle")}</strong>
            <span className={styles.lowBalanceBody}>{t("billing.lowBalanceBody")}</span>
          </div>
          {onOpenPricing ? (
            <button type="button" className={styles.lowBalanceCta} onClick={onOpenPricing}>
              {t("billing.lowBalanceCta")}
            </button>
          ) : null}
        </section>
      ) : null}

      <section className={styles.balanceCard} data-testid="billing-balance">
        {summary.kind === "loading" ? (
          <p className={styles.hint}>{t("billing.loading")}</p>
        ) : summary.kind === "error" ? (
          <p className={styles.hint}>{t("billing.loadError")}</p>
        ) : (
          <>
            <div className={styles.balanceMain}>
              <span className={styles.balanceLabel}>{t("billing.balance")}</span>
              <span className={styles.balanceValue}>
                {formatCredits(summary.summary.balance_micros)} {t("billing.creditUnit")}
              </span>
            </div>
            <div className={styles.balanceHeld}>
              <span>{t("billing.held")}</span>
              <span>
                {formatCredits(summary.summary.held_micros)} {t("billing.creditUnit")}
              </span>
            </div>
            {summary.summary.quota_micros !== null ? (
              <div className={styles.balanceHeld} data-testid="billing-quota">
                <span>
                  {t("billing.quotaLabel")}
                  {summary.summary.quota_period !== null && quotaPeriodKey(summary.summary.quota_period) !== null
                    ? `（${t(quotaPeriodKey(summary.summary.quota_period) as MessageKey)}）`
                    : ""}
                </span>
                <span>
                  {formatCredits(summary.summary.quota_micros)} {t("billing.creditUnit")}
                </span>
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* 余额走势 sparkline：≥2 笔流水时显示（用入账后余额快照重建）。 */}
      {trend.length >= 2 ? (
        <section className={styles.trend} data-testid="billing-trend">
          <div className={styles.trendHead}>
            <span className={styles.trendTitle}>{t("billing.trendTitle")}</span>
            <span className={styles.trendHint}>{t("billing.trendHint", { count: String(trend.length) })}</span>
          </div>
          <BalanceSparkline values={trend} />
        </section>
      ) : null}

      {/* B1d 本月按模型消费分解：有消费才渲染（同 trend 条件渲染范式）。条宽按消费额占比。 */}
      {byModelItems.length > 0 ? (
        <section className={styles.byModel} data-testid="billing-by-model">
          <h3 className={styles.byModelTitle}>{t("billing.byModelTitle")}</h3>
          <ul className={styles.byModelList}>
            {byModelItems.map((it) => (
              <li className={styles.byModelRow} key={it.model_binding_id ?? "unattributed"}>
                <div className={styles.byModelRowHead}>
                  <span className={styles.byModelName} title={it.model_name}>
                    {it.model_name}
                  </span>
                  <span className={styles.byModelSpent}>
                    {formatCredits(it.spent_micros)} {t("billing.creditUnit")}
                  </span>
                </div>
                <div className={styles.byModelBarTrack}>
                  <div
                    className={styles.byModelBar}
                    style={{
                      width: `${byModelMax > 0 ? Math.max(4, (creditsToNumber(it.spent_micros) / byModelMax) * 100) : 0}%`,
                    }}
                  />
                </div>
                <span className={styles.byModelRuns}>
                  {t("billing.byModelRuns", { count: String(it.run_count) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {onOpenPricing ? (
        <button type="button" className={styles.more} onClick={onOpenPricing}>
          {t("billing.viewPricing")}
        </button>
      ) : null}

      <div className={styles.ledgerHeadRow}>
        <h3 className={styles.ledgerHead}>{t("billing.ledgerTitle")}</h3>
        {ledger.kind === "ready" && ledger.entries.length > 0 ? (
          <div className={styles.filters} role="tablist" aria-label={t("billing.ledgerTitle")}>
            {(["all", "spend", "credit"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                className={styles.filterChip}
                data-active={filter === f ? "true" : undefined}
                onClick={() => setFilter(f)}
              >
                {t(
                  f === "all" ? "billing.filterAll" : f === "spend" ? "billing.filterSpend" : "billing.filterCredit",
                )}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {ledger.kind === "loading" ? (
        <p className={styles.hint}>{t("billing.loading")}</p>
      ) : ledger.kind === "error" ? (
        <p className={styles.hint}>{t("billing.loadError")}</p>
      ) : ledger.entries.length === 0 ? (
        <p className={styles.hint}>{t("billing.ledgerEmpty")}</p>
      ) : days.length === 0 ? (
        <p className={styles.hint}>{t("billing.filterEmpty")}</p>
      ) : (
        <>
          {days.map((day) => (
            <div key={day.key} className={styles.dayGroup}>
              <div className={styles.dayHead} data-testid="billing-day">
                <span className={styles.dayLabel}>{day.label}</span>
                <span className={styles.dayNet} data-sign={microSign(day.net)}>
                  {formatSignedCredits(day.net)} {t("billing.creditUnit")}
                </span>
              </div>
              <ul className={styles.ledger}>
                {day.entries.map((entry) => {
                  const key = reasonKey(entry.reason)
                  return (
                    <li key={entry.entry_id} className={styles.entry}>
                      <div className={styles.entryMain}>
                        <span className={styles.entryReason}>{key ? t(key) : entry.reason}</span>
                        <span className={styles.entryMeta}>
                          <span className={styles.entryTime}>{formatTime(entry.created_at)}</span>
                          {entry.run_id ? (
                            <span className={styles.runTag} title={entry.run_id}>
                              {t("billing.runTag", { id: entry.run_id.slice(-6) })}
                            </span>
                          ) : null}
                        </span>
                      </div>
                      <span className={styles.entryDelta} data-sign={microSign(entry.delta_micros)}>
                        {formatSignedCredits(entry.delta_micros)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
          {ledger.cursor !== undefined ? (
            <button type="button" className={styles.more} disabled={ledger.loadingMore} onClick={loadMore}>
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
