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
    void fetch("/api/auth/session-state", { cache: "no-store" })
      .then(async (res) => (res.ok ? parseState(await res.json()) : "anonymous"))
      .then((resolved) => live && setState(resolved === "anonymous" ? "anonymous" : "pass"))
      .catch(() => live && setState("pass"))
    return () => {
      live = false
    }
  }, [])

  return state
}
