"use client"

// 工作区文件抓取：files/deliveries 走同源 `/api/session` 代理，鉴权由 httpOnly 信封 cookie
// 同源自动携带（前端不持 token）。<img>/<iframe> 的 src 虽同源能带 cookie，但需读 bytes 做
// 预览/下载，故一律 fetch → blob → object URL。

import { useEffect, useState } from "react"

export function fileFetch(url: string): Promise<Response> {
  return fetch(url, { cache: "no-store" })
}

type BlobState =
  | { kind: "loading" }
  | { kind: "ready"; objectUrl: string; bytes: number }
  | { kind: "failed" }

// loading 是键控派生的稳定常量：url 未落定（首拉/换 url 在途）恒回落到它，
// 免去 effect 内同步 setState 复位（react-hooks/set-state-in-effect）。
const LOADING: BlobState = { kind: "loading" }

// 鉴权 fetch → object URL（旧 URL 在结果被替换/卸载时 revoke，不泄漏）。enabled=false 时不拉。
export function useFileBlob(url: string, enabled: boolean): BlobState {
  // 落定结果连同其 url 一起存：当前 url 不匹配即视为 loading（派生，无 effect 同步复位）。
  const [settled, setSettled] = useState<{ url: string; state: BlobState } | null>(null)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void fileFetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const blob = await res.blob()
        if (cancelled) return
        setSettled({
          url,
          state: { kind: "ready", objectUrl: URL.createObjectURL(blob), bytes: blob.size },
        })
      })
      .catch(() => {
        if (!cancelled) setSettled({ url, state: { kind: "failed" } })
      })
    return () => {
      cancelled = true
    }
  }, [url, enabled])

  // revoke 与结果生命周期同轨：结果被替换或组件卸载时释放旧 object URL。
  useEffect(() => {
    if (settled?.state.kind !== "ready") return
    const { objectUrl } = settled.state
    return () => URL.revokeObjectURL(objectUrl)
  }, [settled])

  return settled !== null && settled.url === url ? settled.state : LOADING
}
