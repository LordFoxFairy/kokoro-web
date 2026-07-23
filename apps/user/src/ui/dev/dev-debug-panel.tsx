"use client"

// DEV 调试面板（仅 dev）：浮在工作台右下角的可拖拽/可折叠卡片，一眼看清「我此刻是谁、在哪、有多少额度、
// 引擎在什么相位」——把调 kokoro 时最常反复查的运行时事实聚成一处，替代四处翻 devtools/日志。
// 门控：自查 /api/dev/status(enabled 靠 prod 结构性缺失的 mockWebhookSecret 信号,与 mock-pay 同源),
// 生产恒 disabled → 永不渲染。全部只读、皆非机密(用户自己的 namespace/余额/会话 id)；无新写入攻击面。

import { useEffect, useRef, useState } from "react"

import { formatCredits } from "@/billing/format"
import type { BillingClient } from "@/billing/client"
import type { SessionEngine } from "@/engine/machine"
import { useSessionEngine } from "@/engine/use-session-engine"

import styles from "./dev-debug-panel.module.css"

type DevStatus = { enabled: boolean; mockPayAvailable?: boolean; paymentConfigured?: boolean }

const MODE_LABEL: Record<string, string> = { fast: "fast", thinking: "thinking" }

export function DevDebugPanel({
  engine,
  billing,
}: {
  engine: SessionEngine | null
  billing: BillingClient
}) {
  const [status, setStatus] = useState<DevStatus | null>(null)
  const [collapsed, setCollapsed] = useState(false)
  const [namespace, setNamespace] = useState<string | null | undefined>(undefined)
  const [balance, setBalance] = useState<string | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  const snapshot = useSessionEngine(engine)

  // dev 门控自查：非 dev(enabled=false)直接不渲染。
  useEffect(() => {
    let live = true
    void fetch("/api/dev/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((s: DevStatus) => live && setStatus(s))
      .catch(() => live && setStatus({ enabled: false }))
    return () => {
      live = false
    }
  }, [])

  // namespace(当前团队/隔离键，非机密) + 余额：面板打开即拉，可手动刷新。
  const refresh = (): void => {
    void fetch("/api/team/context", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { namespace: null }))
      .then((d: { namespace: string | null }) => setNamespace(d.namespace))
      .catch(() => setNamespace(null))
    void billing
      .summary()
      .then((s) => setBalance(s.balance_micros))
      .catch(() => setBalance(null))
  }
  useEffect(() => {
    if (status?.enabled !== true) return
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅 enabled 变 true 时拉一次；刷新走按钮。
  }, [status?.enabled])

  if (status?.enabled !== true) return null

  const onPointerDown = (e: React.PointerEvent): void => {
    const base = pos ?? { x: window.innerWidth - 300, y: window.innerHeight - 260 }
    dragRef.current = { dx: e.clientX - base.x, dy: e.clientY - base.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    const d = dragRef.current
    if (d === null) return
    setPos({ x: e.clientX - d.dx, y: e.clientY - d.dy })
  }
  const onPointerUp = (e: React.PointerEvent): void => {
    dragRef.current = null
    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
  }

  const style = pos !== null ? { left: `${pos.x}px`, top: `${pos.y}px`, right: "auto", bottom: "auto" } : undefined

  return (
    <aside className={styles.panel} style={style} data-testid="dev-debug-panel" aria-label="dev debug">
      <header
        className={styles.head}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className={styles.dot} aria-hidden />
        <span className={styles.title}>dev</span>
        <span className={styles.spacer} />
        <button type="button" className={styles.iconBtn} onClick={refresh} title="refresh" aria-label="refresh">
          ↻
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? "expand" : "collapse"}
          aria-label={collapsed ? "expand" : "collapse"}
        >
          {collapsed ? "▸" : "▾"}
        </button>
      </header>
      {collapsed ? null : (
        <dl className={styles.body}>
          <Row label="namespace" value={namespace === undefined ? "…" : (namespace ?? "—")} mono />
          <Row label="credits" value={balance === null ? "—" : formatCredits(balance)} />
          <Row label="phase" value={snapshot.machine.phase} />
          <Row label="run" value={snapshot.machine.runId ?? "—"} mono />
          <Row label="session" value={snapshot.store?.activeId ?? "—"} mono />
          <Row label="mode" value={MODE_LABEL[snapshot.pendingMode] ?? snapshot.pendingMode} />
          {snapshot.machine.error !== null ? (
            <Row label="error" value={snapshot.machine.error} danger />
          ) : null}
        </dl>
      )}
    </aside>
  )
}

function Row({
  label,
  value,
  mono,
  danger,
}: {
  label: string
  value: string
  mono?: boolean
  danger?: boolean
}) {
  return (
    <div className={styles.row}>
      <dt className={styles.key}>{label}</dt>
      <dd
        className={styles.val}
        data-mono={mono ? "true" : undefined}
        data-danger={danger ? "true" : undefined}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
