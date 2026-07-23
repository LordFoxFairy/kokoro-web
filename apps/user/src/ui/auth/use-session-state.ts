"use client"

// 会话态探针 hook（AUTH-P0）：httpOnly 信封浏览器读不到，须服务端 `/api/auth/session-state` 裁决。
// authenticated/preview → "pass"（放行）；anonymous → "anonymous"（挡门/落地页）；探针未回前 "checking"。
// 探针失败=放行（沿旧预览档 fail-open 语义）。首页据此在工作台与落地页之间切换，settings 据此挡门。

import { useEffect, useState } from "react"

export type SessionState = "checking" | "pass" | "anonymous"

function parseState(raw: unknown): "authenticated" | "preview" | "anonymous" {
  if (typeof raw === "object" && raw !== null && "state" in raw) {
    const state = (raw as { state: unknown }).state
    if (state === "authenticated" || state === "preview") {
      return state
    }
  }
  return "anonymous"
}

export function useSessionState(): SessionState {
  const [state, setState] = useState<SessionState>("checking")

  useEffect(() => {
    let live = true
    const check = (): void => {
      void fetch("/api/auth/session-state", { cache: "no-store" })
        .then(async (res) => (res.ok ? parseState(await res.json()) : "anonymous"))
        .then((resolved) => live && setState(resolved === "anonymous" ? "anonymous" : "pass"))
        .catch(() => live && setState("pass"))
    }
    check()
    // 复检会话:信封 cookie 随 magic-link TTL 过期（默认 900s），长会话会失效。聚焦/重新可见/每 2 分钟
    // 复检——过期即翻 anonymous,由页面匿名闸送回登录页,避免各处 API 401 裸报"加载失败"。
    const onVisible = (): void => {
      if (document.visibilityState === "visible") {
        check()
      }
    }
    window.addEventListener("focus", check)
    document.addEventListener("visibilitychange", onVisible)
    const timer = setInterval(onVisible, 120_000)
    return () => {
      live = false
      window.removeEventListener("focus", check)
      document.removeEventListener("visibilitychange", onVisible)
      clearInterval(timer)
    }
  }, [])

  return state
}
