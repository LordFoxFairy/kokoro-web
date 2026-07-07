"use client"

// 右侧 canvas 面板：会话在左、内容在右（对标 manus/ChatGPT canvas）。
// 内容体复用格式矩阵；文件可变（agent 迭代同路径），重开即最新。

import { useState } from "react"

import { filePath } from "@/contract/http"
import { sessionBaseUrl } from "@/engine/config"
import { fileFetch } from "@/engine/file-fetch"
import type { WorkspaceFileEntry } from "@/core/state"
import { useT } from "@/i18n/context"
import { PreviewBody, formatBytes } from "@/ui/thread/artifact-card"

import styles from "./canvas-panel.module.css"

export function fileUrl(sessionId: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  return `${sessionBaseUrl()}${filePath(sessionId, "__P__")}`.replace("__P__", encoded)
}

// 下载走鉴权 fetch → blob（<a href> 直连 files 端点鉴权开启后 401）。
async function downloadFile(url: string, name: string): Promise<void> {
  const res = await fileFetch(url)
  if (!res.ok) return
  const objectUrl = URL.createObjectURL(await res.blob())
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

export function CanvasPanel({
  sessionId,
  file,
  files,
  onSelect,
  onClose,
}: {
  sessionId: string
  file: WorkspaceFileEntry
  // 工作区清单（snapshot 水合）：面板内"文件"tab 浏览并切换预览。
  files: WorkspaceFileEntry[]
  onSelect: (file: WorkspaceFileEntry) => void
  onClose: () => void
}) {
  const t = useT()
  const [view, setView] = useState<"preview" | "list">("preview")
  const url = fileUrl(sessionId, file.path)
  const name = file.path.split("/").at(-1) ?? file.path
  return (
    <aside className={styles.panel} aria-label={t("canvas.previewAria", { path: file.path })}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.action}
          onClick={() => setView(view === "list" ? "preview" : "list")}
        >
          {view === "list" ? t("canvas.previewTab") : t("canvas.filesTab")}
        </button>
        <span className={styles.name}>
          {view === "list" ? t("canvas.filesHeading") : file.path}
        </span>
        {view === "preview" ? (
          <span className={styles.meta}>
            {file.mime} · {formatBytes(file.bytes)}
          </span>
        ) : null}
        {view === "preview" ? (
          <button type="button" className={styles.action} onClick={() => void downloadFile(url, name)}>
            {t("canvas.download")}
          </button>
        ) : null}
        <button type="button" className={styles.action} onClick={onClose} aria-label={t("canvas.closePreview")}>
          {t("canvas.close")}
        </button>
      </header>
      <div className={styles.body}>
        {view === "list" ? (
          files.length === 0 ? (
            <p className={styles.meta}>{t("canvas.empty")}</p>
          ) : (
            <ul className={styles.tree}>
              {files.map((entry) => (
                <li key={entry.path}>
                  <button
                    type="button"
                    className={styles.treeItem}
                    onClick={() => {
                      onSelect(entry)
                      setView("preview")
                    }}
                  >
                    <span>{entry.path}</span>
                    <span className={styles.meta}>{formatBytes(entry.bytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <PreviewBody url={url} mime={file.mime} name={name} />
        )}
      </div>
    </aside>
  )
}
