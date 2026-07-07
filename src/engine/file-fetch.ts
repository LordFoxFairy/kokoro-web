"use client"

// 工作区文件抓取：鉴权开启后 files 端点要 Bearer；<img>/<iframe> 的 src 带不了头，
// 故一律 fetch（带 token）→ blob → object URL 供预览/下载，避免裸 URL 撞 401。

import { useEffect, useState } from "react"

const AUTH_TOKEN_KEY = "kokoro.auth.token"

function authHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {}
  const token = window.localStorage.getItem(AUTH_TOKEN_KEY)
  return token === null ? {} : { authorization: `Bearer ${token}` }
}

export function fileFetch(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store", headers: authHeaders() })
}

type BlobState =
  | { kind: "loading" }
  | { kind: "ready"; objectUrl: string; bytes: number }
  | { kind: "failed" }

// 鉴权 fetch → object URL（组件卸载/换 url 即 revoke，不泄漏）。enabled=false 时不拉。
export function useFileBlob(url: string, enabled: boolean): BlobState {
  const [state, setState] = useState<BlobState>({ kind: "loading" })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let created: string | null = null
    setState({ kind: "loading" })
    void fileFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        if (cancelled) return
        created = URL.createObjectURL(blob)
        setState({ kind: "ready", objectUrl: created, bytes: blob.size })
      })
      .catch(() => {
        if (!cancelled) setState({ kind: "failed" })
      })
    return () => {
      cancelled = true
      if (created !== null) URL.revokeObjectURL(created)
    }
  }, [url, enabled])
  return state
}
