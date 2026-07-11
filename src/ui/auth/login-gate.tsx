"use client"

// 登录闸（P2）：无 token 时挡在会话壳之前;登录成功把 token 写进既有注入点
// (localStorage kokoro.auth.token,engine 构造时读取)后整页重载,零改动引擎。
// 部署未接 platform(登录路由 503 auth_not_configured)时自动放行——保留纯前端预览档。
// 视觉：与壳同语言的暖色纸感门面（米白纸底 + pastel 光晕 + 品牌心），antd 组件经
// ConfigProvider 对齐到品牌 token（暖木主色/柔木描边），不再是缺省蓝白卡。

import { useEffect, useState, type ReactNode } from "react"

import { Alert, Button, ConfigProvider, Input, type ThemeConfig } from "antd"

import { useT } from "@/i18n/context"

import styles from "./login-gate.module.css"

export const AUTH_TOKEN_STORAGE_KEY = "kokoro.auth.token"

type GateState = "checking" | "need_login" | "pass"

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

export function LoginGate({ children }: { children: ReactNode }) {
  const t = useT()
  const [state, setState] = useState<GateState>("checking")
  const [email, setEmail] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) !== null) {
      setState("pass")
      return
    }
    // 探一次登录路由:503 auth_not_configured=未接 platform 的预览档,放行走原行为。
    void fetch("/api/auth/login", { method: "POST", body: "{}" })
      .then((res) => setState(res.status === 503 ? "pass" : "need_login"))
      .catch(() => setState("pass"))
  }, [])

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
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      })
      if (!res.ok) {
        setError(res.status === 400 ? t("auth.invalidEmail") : t("auth.unavailable"))
        return
      }
      const body = (await res.json()) as { token: string }
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, body.token)
      window.location.reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfigProvider theme={AUTH_THEME}>
      <div className={styles.screen}>
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
            <Alert className={styles.alert} type="error" message={error} showIcon />
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
      </div>
    </ConfigProvider>
  )
}
