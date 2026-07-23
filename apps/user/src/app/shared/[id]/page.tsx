"use client"

// 公共分享页（SHARE-1，无 auth 公共面）：经同源 /api/shared/{id} 取只读快照并渲染只读线程。
// 无侧栏、无输入框、无控制面。撤销/软删会话/不存在 → 404 友好态。

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"

import { parseSessionSnapshot, type SessionSnapshot } from "@/contract/http"
import { useT } from "@/i18n/context"
import { SharedThread } from "@/ui/shared/shared-thread"

import styles from "./shared.module.css"

type ViewState =
  | { kind: "loading" }
  | { kind: "notFound" }
  | { kind: "ready"; snapshot: SessionSnapshot }

export default function SharedPage() {
  const t = useT()
  const params = useParams<{ id: string }>()
  const shareId = typeof params.id === "string" ? params.id : ""
  // 空段（防御性，路由 [id] 恒有单段）：初态即 notFound，effect 不再同步 setState。
  const [state, setState] = useState<ViewState>(() =>
    shareId === "" ? { kind: "notFound" } : { kind: "loading" },
  )

  useEffect(() => {
    if (shareId === "") return
    let live = true
    void (async () => {
      try {
        const res = await fetch(`/api/shared/${encodeURIComponent(shareId)}`, { cache: "no-store" })
        if (!res.ok) {
          if (live) setState({ kind: "notFound" })
          return
        }
        const snapshot = parseSessionSnapshot(await res.json())
        if (live) setState({ kind: "ready", snapshot })
      } catch {
        // 网络/解析失败：与不可达同不透明 404 态（公共面不泄内部细节）。
        if (live) setState({ kind: "notFound" })
      }
    })()
    return () => {
      live = false
    }
  }, [shareId])

  if (state.kind === "loading") {
    return (
      <main className={styles.page}>
        <p className={styles.hint}>{t("shared.loading")}</p>
      </main>
    )
  }

  if (state.kind === "notFound") {
    return (
      <main className={styles.page} data-testid="shared-notfound">
        <div className={styles.notFound}>
          <h1 className={styles.notFoundTitle}>{t("shared.notFound")}</h1>
          <p className={styles.notFoundHint}>{t("shared.notFoundHint")}</p>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.page} data-testid="shared-page">
      <header className={styles.header}>
        <div className={styles.brand} aria-hidden>
          心
        </div>
        <div className={styles.headText}>
          <h1 className={styles.title}>{state.snapshot.session.title}</h1>
          <p className={styles.badge}>{t("shared.readonlyBadge")}</p>
        </div>
      </header>
      <div className={styles.thread}>
        <SharedThread snapshot={state.snapshot} />
      </div>
    </main>
  )
}
