"use client"

// 右侧 canvas 面板：会话在左、内容在右（对标 manus/ChatGPT canvas）。
// 内容体复用格式矩阵；文件可变（agent 迭代同路径），重开即最新。

import { useState } from "react"

import { filePath } from "@/contract/http"
import { sessionBaseUrl } from "@/engine/config"
import type { WorkspaceFileEntry } from "@/core/state"
import { useT } from "@/i18n/context"
import { PreviewBody, formatBytes } from "@/ui/thread/artifact-card"

import styles from "./canvas-panel.module.css"

export function fileUrl(sessionId: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  return `${sessionBaseUrl()}${filePath(sessionId, "__P__")}`.replace("__P__", encoded)
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
          <a className={styles.action} href={url} download={name}>
            {t("canvas.download")}
          </a>
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
