"use client"

// httpOnly Site 会话由服务端裁决；浏览器永远不读取 Platform credential。

import { useEffect, useState } from "react"

export type SessionState = "checking" | "pass" | "anonymous"

function parseState(raw: unknown): "authenticated" | "anonymous" {
  if (typeof raw === "object" && raw !== null && "state" in raw) {
    const state = (raw as { state: unknown }).state
    if (state === "authenticated") return state
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
        .catch(() => live && setState("anonymous"))
    }
    check()
    // 聚焦/重新可见/每 2 分钟复检；JWT callback 在需要时执行 refresh。
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
