"use client"

// DEV 模拟收银台：真网关收银台的 dev 替身。「确认支付」→ POST /api/billing/mock-pay（签 mock webhook
// 驱动 confirmOrder 到账）→ 成功后回工作区，余额随之刷新。仅 dev；生产由真网关托管收银台替代。
import Link from "next/link"
import { useState } from "react"

import { useT } from "@/i18n/context"

type PayState = "idle" | "paying" | "paid" | "error"

export function MockPayPanel({ orderId }: { orderId: string }): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<PayState>("idle")

  async function pay(): Promise<void> {
    setState("paying")
    try {
      const res = await fetch("/api/billing/mock-pay", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      })
      setState(res.ok ? "paid" : "error")
    } catch {
      setState("error")
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "24px",
        background: "var(--k-bg, #faf7f2)",
        color: "var(--k-fg, #1a1a1a)",
      }}
    >
      <section
        style={{
          width: "min(420px, 100%)",
          border: "1px solid var(--k-border, #e6e0d6)",
          borderRadius: 16,
          padding: "28px 24px",
          background: "var(--k-surface, #fff)",
          boxShadow: "0 8px 30px rgba(0,0,0,0.06)",
        }}
      >
        <p style={{ fontSize: 12, letterSpacing: 1, opacity: 0.6, margin: 0 }}>{t("mockPay.badge")}</p>
        <h1 style={{ fontSize: 20, margin: "8px 0 4px" }}>{t("mockPay.title")}</h1>
        <p style={{ fontSize: 13, opacity: 0.7, margin: "0 0 20px" }}>
          {t("mockPay.order")} <code style={{ fontFamily: "ui-monospace, monospace" }}>{orderId}</code>
        </p>

        {state === "paid" ? (
          <>
            <p style={{ color: "#15803d", fontWeight: 600, margin: "0 0 16px" }}>✓ {t("mockPay.paid")}</p>
            <Link
              href="/"
              style={{
                display: "block",
                textAlign: "center",
                padding: "12px",
                borderRadius: 10,
                background: "var(--k-accent, #2563eb)",
                color: "#fff",
                textDecoration: "none",
                fontWeight: 600,
              }}
            >
              {t("mockPay.back")}
            </Link>
          </>
        ) : (
          <>
            {state === "error" ? (
              <p style={{ color: "#b91c1c", fontSize: 13, margin: "0 0 12px" }}>{t("mockPay.error")}</p>
            ) : null}
            <button
              type="button"
              onClick={pay}
              disabled={state === "paying"}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: 10,
                border: "none",
                background: state === "paying" ? "#9aa" : "var(--k-accent, #2563eb)",
                color: "#fff",
                fontWeight: 600,
                cursor: state === "paying" ? "default" : "pointer",
              }}
            >
              {state === "paying" ? t("mockPay.paying") : t("mockPay.confirm")}
            </button>
            <Link href="/" style={{ display: "block", textAlign: "center", marginTop: 12, fontSize: 13, opacity: 0.7 }}>
              {t("mockPay.cancel")}
            </Link>
          </>
        )}
      </section>
    </main>
  )
}
