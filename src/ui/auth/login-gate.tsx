"use client"

// 登录闸（P2）：无 token 时挡在会话壳之前;登录成功把 token 写进既有注入点
// (localStorage kokoro.auth.token,engine 构造时读取)后整页重载,零改动引擎。
// 部署未接 platform(登录路由 503 auth_not_configured)时自动放行——保留纯前端预览档。

import { useEffect, useState, type ReactNode } from "react"

import { Alert, Button, Card, Input, Typography } from "antd"

import { useT } from "@/i18n/context"

export const AUTH_TOKEN_STORAGE_KEY = "kokoro.auth.token"

type GateState = "checking" | "need_login" | "pass"

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
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
      <Card style={{ width: 360 }} data-testid="login-gate">
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          {t("auth.title")}
        </Typography.Title>
        <Typography.Paragraph type="secondary">{t("auth.subtitle")}</Typography.Paragraph>
        <Input
          placeholder={t("auth.emailPlaceholder")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onPressEnter={() => void submit()}
          disabled={busy}
          data-testid="login-email"
        />
        {error === null ? null : (
          <Alert style={{ marginTop: 12 }} type="error" message={error} showIcon />
        )}
        <Button
          type="primary"
          block
          style={{ marginTop: 16 }}
          loading={busy}
          onClick={() => void submit()}
          data-testid="login-submit"
        >
          {t("auth.submit")}
        </Button>
      </Card>
    </div>
  )
}
