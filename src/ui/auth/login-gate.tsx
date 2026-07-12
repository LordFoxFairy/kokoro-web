"use client"

// 登录闸（AUTH-P0）：无有效会话时挡在会话壳之前。改探服务端 `/api/auth/session-state`
// （httpOnly 信封浏览器读不到，须服务端裁决）：authenticated/preview 放行，anonymous 挡门。
// 登录走 magic-link——提交邮箱只发 `/api/auth/magic-link/request`（BFF 设 nonce cookie + 交 user），
// 真正换取会话在邮件链接的 `/api/auth/callback` 完成（密封 cookie + 303）。前端不再持 token。
// 部署未接 platform（session-state=preview）时自动放行——保留纯前端预览档。
// 视觉：与壳同语言的暖色纸感门面（米白纸底 + pastel 光晕 + 品牌心），antd 组件经
// ConfigProvider 对齐到品牌 token。

import { useEffect, useState, type ReactNode } from "react"

import { Alert, Button, ConfigProvider, Input, type ThemeConfig } from "antd"

import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"

import styles from "./login-gate.module.css"

type GateState = "checking" | "need_login" | "sent" | "pass"

// 暖色纸感 antd 主题：主色暖木、描边柔木、卡面暖白、圆角柔化——与壳 token 同源取值。
// antd 主题算法需要实色 hex，无法直吃 CSS 变量，故此处与 globals.css 的 --k-* 取值保持一致。
const AUTH_THEME: ThemeConfig = {
  token: {
    colorPrimary: "#8b6f47",
    colorText: "#2b2520",
    colorBorder: "#ebe0cf",
    colorBgContainer: "#ffffff",
    borderRadius: 10,
    controlHeight: 38,
    fontFamily:
      'Arial, Helvetica, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  components: {
    Button: { primaryShadow: "none" },
  },
}

// 品牌「心」标（Kokoro=心）：暖木填充实心心形，非可翻译文案。
function HeartMark() {
  return (
    <svg className={styles.brandIcon} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 20.5s-7.4-4.6-9.6-9C1.1 8.7 2.3 5.4 5.4 4.7c2-.45 3.9.55 4.9 2.2l1.7 2.8 1.7-2.8c1-1.65 2.9-2.65 4.9-2.2 3.1.7 4.3 4 2.99 6.8-2.19 4.4-9.59 9-9.59 9z" />
    </svg>
  )
}

// 首帧就知道回调是否失败（?auth=link_unavailable），据此在登录卡上给重发提示。
function initialLinkError(): boolean {
  if (typeof window === "undefined") {
    return false
  }
  return new URLSearchParams(window.location.search).get("auth") === "link_unavailable"
}

const stateResponseSchema = (raw: unknown): "authenticated" | "preview" | "anonymous" => {
  if (typeof raw === "object" && raw !== null && "state" in raw) {
    const state = (raw as { state: unknown }).state
    if (state === "authenticated" || state === "preview") {
      return state
    }
  }
  return "anonymous"
}

export function LoginGate({ children }: { children: ReactNode }) {
  const t = useT()
  const [state, setState] = useState<GateState>("checking")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<MessageKey | null>(() =>
    initialLinkError() ? "auth.linkUnavailable" : null,
  )
  const [devLink, setDevLink] = useState<string | null>(null)

  useEffect(() => {
    if (state !== "checking") {
      return
    }
    // 服务端裁决会话态：有效信封=authenticated（放行）；未接 platform=preview（放行走预览）；
    // 否则 anonymous（挡门）。探针失败=放行（沿旧预览档 fail-open 语义）。
    void fetch("/api/auth/session-state", { cache: "no-store" })
      .then(async (res) => (res.ok ? stateResponseSchema(await res.json()) : "anonymous"))
      .then((resolved) => setState(resolved === "anonymous" ? "need_login" : "pass"))
      .catch(() => setState("pass"))
  }, [state])

  if (state === "pass") {
    return <>{children}</>
  }
  if (state === "checking") {
    return null
  }

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/auth/magic-link/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        if (res.status === 400) {
          setError("auth.invalidEmail")
        } else if (res.status === 429) {
          setError("auth.rateLimited")
        } else {
          setError("auth.unavailable")
        }
        return
      }
      const body = (await res.json()) as { dev_link?: string }
      setDevLink(typeof body.dev_link === "string" ? body.dev_link : null)
      setState("sent")
    } catch {
      setError("auth.unavailable")
    } finally {
      setBusy(false)
    }
  }

  const card =
    state === "sent" ? (
      <div className={styles.card} data-testid="login-sent">
        <span className={styles.brand} aria-hidden>
          <HeartMark />
        </span>
        <h1 className={styles.title}>{t("auth.sentTitle")}</h1>
        <p className={styles.subtitle}>{t("auth.sentBody")}</p>
        {devLink === null ? null : (
          <Button
            className={styles.submit}
            type="primary"
            size="large"
            block
            href={devLink}
            data-testid="dev-link"
          >
            {t("auth.devLink")}
          </Button>
        )}
        <Button
          className={styles.submit}
          type="link"
          size="large"
          block
          onClick={() => {
            setState("need_login")
            setDevLink(null)
          }}
          data-testid="login-restart"
        >
          {t("auth.resend")}
        </Button>
      </div>
    ) : (
      <div className={styles.card} data-testid="login-gate">
        <span className={styles.brand} aria-hidden>
          <HeartMark />
        </span>
        <h1 className={styles.title}>{t("auth.title")}</h1>
        <p className={styles.subtitle}>{t("auth.subtitle")}</p>
        <div className={styles.field}>
          <Input
            size="large"
            placeholder={t("auth.emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onPressEnter={() => void submit()}
            disabled={busy}
            data-testid="login-email"
          />
        </div>
        {error === null ? null : (
          <Alert className={styles.alert} type="error" message={t(error)} showIcon />
        )}
        <Button
          className={styles.submit}
          type="primary"
          size="large"
          block
          loading={busy}
          onClick={() => void submit()}
          data-testid="login-submit"
        >
          {t("auth.submit")}
        </Button>
      </div>
    )

  return (
    <ConfigProvider theme={AUTH_THEME}>
      <div className={styles.screen}>{card}</div>
    </ConfigProvider>
  )
}
