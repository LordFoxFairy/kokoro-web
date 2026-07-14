"use client"

// 登录页面板（WEB-FACE 面二，/login）：magic-link 签发链 web 端。机制与旧登录闸零改动——
// 提交邮箱只 POST `/api/auth/magic-link/request`（BFF 设 nonce cookie + 交 user），真正换取会话在
// 邮件链接的 `/api/auth/callback` 完成（密封 cookie + 303 回 `/`）。前端不持 token。
// 形态：浅底全屏 + 居中暖纸卡；错误走 toast 归一（不内联报错）；发送后态给检查邮箱卡 + 重发倒计时
// + 改邮箱返回。dev response 档保留可点开发链。OAuth 不放假按钮——留不渲染的插槽（见下）。

import { useEffect, useState } from "react"
import Link from "next/link"

import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"

import styles from "./login-panel.module.css"

type Phase = "idle" | "sent"

const RESEND_SECONDS = 30

// 品牌「心」标（Kokoro=心）：暖木填充实心心形，非可翻译文案。
function HeartMark() {
  return (
    <svg className={styles.brandIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 20.5s-7.4-4.6-9.6-9C1.1 8.7 2.3 5.4 5.4 4.7c2-.45 3.9.55 4.9 2.2l1.7 2.8 1.7-2.8c1-1.65 2.9-2.65 4.9-2.2 3.1.7 4.3 4 2.99 6.8-2.19 4.4-9.59 9-9.59 9z" />
    </svg>
  )
}

// 首帧就知道回调是否失败（?auth=link_unavailable），据此弹一次错误 toast。
function initialLinkError(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return new URLSearchParams(window.location.search).get("auth") === "link_unavailable"
}

export function LoginPanel({ brandName }: { brandName?: string }) {
  const t = useT()
  const brand = brandName ?? "Kokoro"
  const [phase, setPhase] = useState<Phase>("idle")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)
  // 回调失败落点（callback 303 到 `/?auth=…`，落地页转投 `/login?auth=…`）：懒初始化即弹一次重发提示。
  const [toast, setToast] = useState<MessageKey | null>(() =>
    initialLinkError() ? "auth.linkUnavailable" : null,
  )
  const [resendIn, setResendIn] = useState(0)

  // toast 归一自动消：toast 一变即排 5s 后清；新错误重置计时（依赖 toast 使计时随之刷新）。
  useEffect(() => {
    if (toast === null) {
      return
    }
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  // 设一条错误 toast（自动消由上面的 effect 接管）。
  const showToast = (key: MessageKey): void => {
    setToast(key)
  }

  // 发送后态重发倒计时：每秒递减到 0 才允许再次发送。
  useEffect(() => {
    if (resendIn <= 0) {
      return
    }
    const id = setTimeout(() => setResendIn((value) => value - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const submit = async (): Promise<void> => {
    setBusy(true)
    try {
      const res = await fetch("/api/auth/magic-link/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        if (res.status === 400) {
          showToast("auth.invalidEmail")
        } else if (res.status === 429) {
          showToast("auth.rateLimited")
        } else {
          showToast("auth.unavailable")
        }
        return
      }
      const body = (await res.json()) as { dev_link?: string }
      setDevLink(typeof body.dev_link === "string" ? body.dev_link : null)
      setPhase("sent")
      setResendIn(RESEND_SECONDS)
    } catch {
      showToast("auth.unavailable")
    } finally {
      setBusy(false)
    }
  }

  const backToIdle = (): void => {
    setPhase("idle")
    setDevLink(null)
    setResendIn(0)
  }

  return (
    <div className={styles.screen}>
      {/* 顶栏：仅品牌，回首页；页脚隐藏（登录是收窄的专注面）。 */}
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label={brand}>
          <span className={styles.brandDot} aria-hidden>
            <HeartMark />
          </span>
          <span className={styles.brandName}>{brand}</span>
        </Link>
      </header>

      {/* toast 归一（限频 429 / 签发失败 / 链接失效）：卡外浮层，不在表单内联报错。 */}
      {toast !== null ? (
        <div className={styles.toast} role="alert" data-testid="login-toast">
          {t(toast)}
        </div>
      ) : null}

      <div className={styles.stage}>
        {phase === "sent" ? (
          <div className={styles.card} data-testid="login-sent">
            <span className={styles.brandBadge} aria-hidden>
              <HeartMark />
            </span>
            <h1 className={styles.title}>{t("auth.sentTitle")}</h1>
            <p className={styles.subtitle}>{t("auth.sentBody")}</p>
            {devLink !== null ? (
              <a className={styles.primaryLink} href={devLink} data-testid="dev-link">
                {t("auth.devLink")}
              </a>
            ) : null}
            <div className={styles.sentActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                disabled={resendIn > 0 || busy}
                onClick={() => void submit()}
                data-testid="login-resend"
              >
                {resendIn > 0 ? t("auth.sentResendIn", { seconds: resendIn }) : t("auth.sentResendNow")}
              </button>
              <button
                type="button"
                className={styles.linkBtn}
                onClick={backToIdle}
                data-testid="login-change-email"
              >
                {t("auth.sentChangeEmail")}
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.card} data-testid="login-panel">
            <span className={styles.brandBadge} aria-hidden>
              <HeartMark />
            </span>
            <h1 className={styles.title}>{t("auth.title")}</h1>
            <p className={styles.subtitle}>{t("auth.subtitle")}</p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>{t("auth.emailLabel")}</span>
              <input
                className={styles.input}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder={t("auth.emailPlaceholder")}
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault()
                    void submit()
                  }
                }}
                data-testid="login-email"
              />
            </label>

            <button
              type="button"
              className={styles.primaryBtn}
              disabled={busy}
              onClick={() => void submit()}
              data-testid="login-submit"
            >
              {t("auth.submit")}
            </button>

            {/*
              OAuth 插槽（诚实态）：provider 未接入前不渲染任何假按钮。接入后在此处按 provider
              配置渲染社交登录入口，并保留同一 toast 错误归一。
            */}

            <p className={styles.note}>{t("auth.noAccount")}</p>
          </div>
        )}
      </div>
    </div>
  )
}
