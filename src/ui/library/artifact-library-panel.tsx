"use client"

// 作品库面板（ARTIFACT-LIB）：属主 namespace 全部成果跨会话聚合的卡片网格——
// mime 图标 / 标题 / 时间 / 来源会话跳转；点击下载（鉴权 blob）；复合游标滚动翻页；空态。
// 成果不可变、内容寻址：与可变工作区文件面分离，只读展示。

import { useCallback, useEffect, useState } from "react"

import { artifactContentPath, type ArtifactRecord } from "@/contract/http"
import type { SessionClient } from "@/engine/client"
import { sessionBaseUrl } from "@/engine/config"
import { fileFetch } from "@/engine/file-fetch"
import { useLocale, useT } from "@/i18n/context"
import { formatBytes } from "@/ui/thread/artifact-card"
import { formatDeliveryTime } from "@/ui/canvas/canvas-panel"
import { DeliveryIcon } from "@/ui/icons/thread"

import styles from "./artifact-library-panel.module.css"

type LibraryState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; artifacts: ArtifactRecord[]; cursor: string | undefined; loadingMore: boolean }

type ArtifactLibraryPanelProps = {
  client: Pick<SessionClient, "listArtifacts">
  onClose: () => void
  // 来源会话跳转：切到该 sessionId 并关闭面板。
  onOpenSession: (sessionId: string) => void
}

// 下载走鉴权 fetch → blob（内容端点鉴权开启后 <a href> 直连 401）。
async function downloadArtifact(url: string, name: string): Promise<void> {
  const res = await fileFetch(url)
  if (!res.ok) return
  const objectUrl = URL.createObjectURL(await res.blob())
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

function artifactUrl(contentHash: string): string {
  return `${sessionBaseUrl()}${artifactContentPath(encodeURIComponent(contentHash))}`
}

type LibraryContentProps = {
  client: Pick<SessionClient, "listArtifacts">
  // 来源会话跳转：切到该 sessionId（关闭责任移交调用方）。
  onOpenSession: (sessionId: string) => void
}

export function LibraryContent({ client, onOpenSession }: LibraryContentProps) {
  const t = useT()
  const { locale } = useLocale()
  const [state, setState] = useState<LibraryState>({ kind: "loading" })

  const load = useCallback(async (): Promise<LibraryState> => {
    try {
      const page = await client.listArtifacts()
      return { kind: "ready", artifacts: page.artifacts, cursor: page.next_cursor, loadingMore: false }
    } catch {
      return { kind: "error" }
    }
  }, [client])

  useEffect(() => {
    void load().then(setState)
  }, [load])

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || state.cursor === undefined || state.loadingMore) {
      return
    }
    const cursor = state.cursor
    setState({ ...state, loadingMore: true })
    try {
      const page = await client.listArtifacts(cursor)
      setState({
        kind: "ready",
        artifacts: [...state.artifacts, ...page.artifacts],
        cursor: page.next_cursor,
        loadingMore: false,
      })
    } catch {
      setState({ ...state, loadingMore: false })
    }
  }, [client, state])

  return (
    <div className={styles.body}>
          {state.kind === "loading" ? (
            <p className={styles.hint}>{t("library.loading")}</p>
          ) : state.kind === "error" ? (
            <p className={styles.hint}>{t("library.loadError")}</p>
          ) : state.artifacts.length === 0 ? (
            <p className={styles.hint} data-testid="library-empty">
              {t("library.empty")}
            </p>
          ) : (
            <>
              <div className={styles.grid} data-testid="library-grid">
                {state.artifacts.map((artifact) => (
                  <div className={styles.card} key={artifact.content_hash}>
                    <button
                      type="button"
                      className={styles.open}
                      aria-label={t("library.downloadAria", { title: artifact.title })}
                      onClick={() =>
                        void downloadArtifact(artifactUrl(artifact.content_hash), artifact.title)
                      }
                    >
                      <DeliveryIcon className={styles.icon} />
                      <span className={styles.cardBody}>
                        <span className={styles.cardTitle}>{artifact.title}</span>
                        <span className={styles.meta}>
                          {formatBytes(artifact.size)} · {formatDeliveryTime(artifact.created_at, locale)}
                        </span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className={styles.source}
                      onClick={() => onOpenSession(artifact.session_id)}
                    >
                      {t("library.openSource")}
                    </button>
                  </div>
                ))}
              </div>
              {state.cursor !== undefined ? (
                <button
                  type="button"
                  className={styles.more}
                  disabled={state.loadingMore}
                  onClick={loadMore}
                >
                  {state.loadingMore ? t("library.loading") : t("library.loadMore")}
                </button>
              ) : null}
            </>
          )}
    </div>
  )
}

export function ArtifactLibraryPanel({ client, onClose, onOpenSession }: ArtifactLibraryPanelProps) {
  const t = useT()

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("library.title")}
        className={styles.panel}
        data-testid="library-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <h2 className={styles.title}>{t("library.title")}</h2>
          <button type="button" className={styles.close} aria-label={t("library.close")} onClick={onClose}>
            ×
          </button>
        </header>

        <LibraryContent client={client} onOpenSession={onOpenSession} />
      </div>
    </div>
  )
}
