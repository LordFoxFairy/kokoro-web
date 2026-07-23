"use client"

// 会话头部分享控件（SHARE-1）：创建可撤销只读分享 → 复制公共链接 / 撤销。
// 创建幂等（活跃分享返同 id）；撤销后公共链接随即 404。公共链接=同源 /shared/{share_id}。

import { useCallback, useState } from "react"

import type { SessionClient } from "@/engine/client"
import { useT } from "@/i18n/context"

import styles from "./share-button.module.css"

type ShareState =
  | { kind: "idle" }
  | { kind: "creating" }
  | { kind: "shared"; url: string; copied: boolean }
  | { kind: "error" }

type ShareButtonProps = {
  client: Pick<SessionClient, "createShare" | "revokeShare">
  sessionId: string
}

function shareUrl(shareId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : ""
  return `${origin}/shared/${shareId}`
}

export function ShareButton({ client, sessionId }: ShareButtonProps) {
  const t = useT()
  const [state, setState] = useState<ShareState>({ kind: "idle" })

  const create = useCallback(async () => {
    setState({ kind: "creating" })
    try {
      const receipt = await client.createShare(sessionId)
      setState({ kind: "shared", url: shareUrl(receipt.share_id), copied: false })
    } catch {
      setState({ kind: "error" })
    }
  }, [client, sessionId])

  const copy = useCallback(async () => {
    if (state.kind !== "shared") return
    try {
      await navigator.clipboard.writeText(state.url)
      setState({ ...state, copied: true })
    } catch {
      // 剪贴板不可用（无 https/权限）：链接仍可见可手动复制，不阻断。
    }
  }, [state])

  const revoke = useCallback(async () => {
    try {
      await client.revokeShare(sessionId)
    } catch {
      // 撤销失败保持已分享态：不误导用户以为已撤销。
      return
    }
    setState({ kind: "idle" })
  }, [client, sessionId])

  return (
    <div className={styles.wrap} data-testid="share-control">
      {state.kind === "shared" ? (
        <div className={styles.popover} role="dialog" aria-label={t("share.title")}>
          <p className={styles.hint}>{t("share.readonlyHint")}</p>
          <div className={styles.linkRow}>
            <input className={styles.link} readOnly value={state.url} aria-label={t("share.linkAria")} />
            <button type="button" className={styles.copy} onClick={() => void copy()}>
              {state.copied ? t("share.copied") : t("share.copy")}
            </button>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.revoke} onClick={() => void revoke()}>
              {t("share.revoke")}
            </button>
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => setState({ kind: "idle" })}
            >
              {t("share.done")}
            </button>
          </div>
        </div>
      ) : null}
      <button
        type="button"
        className={styles.trigger}
        data-testid="share-button"
        disabled={state.kind === "creating"}
        onClick={() => void create()}
      >
        {state.kind === "creating" ? t("share.creating") : t("share.button")}
      </button>
      {state.kind === "error" ? <span className={styles.err}>{t("share.error")}</span> : null}
    </div>
  )
}
