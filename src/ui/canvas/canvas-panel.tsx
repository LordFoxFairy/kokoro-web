"use client"

// 右侧 canvas 面板：会话在左、内容在右（对标 manus/ChatGPT canvas）。
// 内容体复用产物格式矩阵；同路径新版本由调用方以最新引用重开。

import type { ToolArtifact } from "@/core/state"
import { PreviewBody, artifactUrl, formatBytes } from "@/ui/thread/artifact-card"

import styles from "./canvas-panel.module.css"

export function CanvasPanel({
  sessionId,
  artifact,
  onClose,
}: {
  sessionId: string
  artifact: ToolArtifact
  onClose: () => void
}) {
  const url = artifactUrl(sessionId, artifact)
  return (
    <aside className={styles.panel} aria-label={`canvas 预览 ${artifact.name}`}>
      <header className={styles.head}>
        <span className={styles.name}>{artifact.name}</span>
        <span className={styles.meta}>
          {artifact.mime} · {formatBytes(artifact.bytes)}
        </span>
        <a className={styles.action} href={url} download={artifact.name}>
          下载
        </a>
        <button type="button" className={styles.action} onClick={onClose} aria-label="关闭预览">
          关闭
        </button>
      </header>
      <div className={styles.body}>
        <PreviewBody url={url} artifact={artifact} />
      </div>
    </aside>
  )
}
