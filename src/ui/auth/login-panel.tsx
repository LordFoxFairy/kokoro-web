"use client"

// 登录页面板（WEB-FACE 面二，/login）：magic-link 签发链 web 端。机制与旧登录闸零改动——
// 提交邮箱只 POST `/api/auth/magic-link/request`（BFF 设 nonce cookie + 交 user），真正换取会话在
// 邮件链接的 `/api/auth/callback` 完成（密封 cookie + 303 回 `/`）。前端不持 token。
// 形态对标参考:浅底全屏 + 共用顶栏 + 居中宽白卡；标题→email→**大主按钮(发送登录链接)**→分隔→
// OAuth 诚实占位(禁用「即将开放」,不放假按钮)→底部注册说明。magic-link 无密码,故不放密码框/找回。
// 错误走 toast 归一(不内联);发送后态给检查邮箱卡 + 重发倒计时 + 改邮箱。dev response 档保留可点链。

import { useEffect, useState } from "react"

import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"
import { MarketingTopBar } from "@/ui/marketing/marketing-top-bar"

import styles from "./login-panel.module.css"

type Phase = "idle" | "sent"

const RESEND_SECONDS = 30

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

  // toast 归一自动消：toast 一变即排 5s 后清；新错误重置计时。
  useEffect(() => {
    if (toast === null) {
      return
    }
    const id = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(id)
  }, [toast])

  // 发送后态重发倒计时：每秒递减到 0 才允许再次发送。
  useEffect(() => {
    if (resendIn <= 0) {
      return
    }
    const id = setTimeout(() => setResendIn((value) => value - 1), 1000)
    return () => clearTimeout(id)
  }, [resendIn])

  const showToast = (key: MessageKey): void => {
    setToast(key)
  }

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
      <MarketingTopBar brandName={brand} />

      {/* toast 归一（限频 429 / 签发失败 / 链接失效）：卡外浮层，不在表单内联报错。 */}
      {toast !== null ? (
        <div className={styles.toast} role="alert" data-testid="login-toast">
          {t(toast)}
        </div>
      ) : null}

      <div className={styles.stage}>
        {phase === "sent" ? (
          <div className={styles.card} data-testid="login-sent">
            <h1 className={styles.title}>{t("auth.sentTitle")}</h1>
            <p className={styles.subtitle}>{t("auth.sentBody")}</p>
            {devLink !== null ? (
              <a className={styles.primaryBtn} href={devLink} data-testid="dev-link">
                {t("auth.devLink")}
              </a>
            ) : null}
            <button
              type="button"
              className={styles.secondaryBtn}
              disabled={resendIn > 0 || busy}
              onClick={() => void submit()}
              data-testid="login-resend"
            >
              {resendIn > 0 ? t("auth.sentResendIn", { seconds: resendIn }) : t("auth.sentResendNow")}
            </button>
            <p className={styles.switchLine}>
              <button
                type="button"
                className={styles.switchLink}
                onClick={backToIdle}
                data-testid="login-change-email"
              >
                {t("auth.sentChangeEmail")}
              </button>
            </p>
          </div>
        ) : (
          <div className={styles.card} data-testid="login-panel">
            <h1 className={styles.title}>{t("auth.title")}</h1>

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
              <span>{t("auth.submit")}</span>
              <span className={styles.primaryArrow} aria-hidden>
                →
              </span>
            </button>

            <div className={styles.divider}>
              <span>{t("auth.orDivider")}</span>
            </div>

            {/*
              OAuth 诚实占位（诚实态）：provider 未接入前不放可用假按钮，保留视觉占位骨架使卡片不塌陷——
              禁用态明确「即将开放」。接入 provider 后在此处按配置换真实社交登录入口，沿用同一 toast 归一。
            */}
            <button
              type="button"
              className={styles.oauthPlaceholder}
              disabled
              aria-disabled="true"
              data-testid="login-oauth-slot"
            >
              {t("auth.oauthSoon")}
            </button>

            <p className={styles.switchLine}>{t("auth.noAccount")}</p>
          </div>
        )}
      </div>
    </div>
  )
}
