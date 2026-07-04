"use client"

// 产物预览卡：按 MIME 主类分派的全格式矩阵；文本类懒加载（点开才拉字节），媒体类浏览器原生流式。

import { useEffect, useState } from "react"

import { artifactPath } from "@/contract/http"
import { sessionBaseUrl } from "@/engine/config"
import type { ToolArtifact } from "@/core/state"
import { MarkdownMessage } from "./markdown-message"

import styles from "./artifact-card.module.css"

const TEXT_PREVIEW_MAX_BYTES = 64 * 1024
const CSV_PREVIEW_MAX_ROWS = 200

function artifactUrl(sessionId: string, artifact: ToolArtifact): string {
  const encoded = artifact.artifact_id.split("/").map(encodeURIComponent).join("/")
  return `${sessionBaseUrl()}${artifactPath(sessionId, "__ID__")}`.replace("__ID__", encoded)
}

function formatBytes(count: number): string {
  if (count < 1024) return `${count} B`
  if (count < 1024 * 1024) return `${(count / 1024).toFixed(1)} KB`
  return `${(count / (1024 * 1024)).toFixed(1)} MB`
}

type TextPreview = { kind: "loading" } | { kind: "text"; text: string; truncated: boolean } | { kind: "failed" }

function useTextPreview(url: string, enabled: boolean): TextPreview {
  const [preview, setPreview] = useState<TextPreview>({ kind: "loading" })
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    void fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const buffer = await res.arrayBuffer()
        const truncated = buffer.byteLength > TEXT_PREVIEW_MAX_BYTES
        const text = new TextDecoder("utf-8", { fatal: true }).decode(
          buffer.slice(0, TEXT_PREVIEW_MAX_BYTES),
        )
        if (!cancelled) setPreview({ kind: "text", text, truncated })
      })
      .catch(() => {
        // 解码失败/拉取失败：降级下载卡，绝不因预览失败丢产物入口。
        if (!cancelled) setPreview({ kind: "failed" })
      })
    return () => {
      cancelled = true
    }
  }, [url, enabled])
  return preview
}

function CsvTable({ text }: { text: string }) {
  const rows = text.split("\n").filter((line) => line.length > 0).slice(0, CSV_PREVIEW_MAX_ROWS)
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <tbody>
          {rows.map((line, i) => (
            <tr key={i}>
              {line.split(",").map((cell, j) => (
                <td key={j}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TextualPreview({ url, mime }: { url: string; mime: string }) {
  const preview = useTextPreview(url, true)
  if (preview.kind === "loading") return <p className={styles.note}>加载预览…</p>
  if (preview.kind === "failed") return <p className={styles.note}>无法预览，请下载查看。</p>
  const body =
    mime === "text/markdown" ? (
      <MarkdownMessage content={preview.text} />
    ) : mime === "application/json" ? (
      <pre className={styles.code}>{formatJson(preview.text)}</pre>
    ) : mime === "text/csv" ? (
      <CsvTable text={preview.text} />
    ) : (
      <pre className={styles.code}>{preview.text}</pre>
    )
  return (
    <>
      {body}
      {preview.truncated ? <p className={styles.note}>预览已截断（前 64KB），完整内容请下载。</p> : null}
    </>
  )
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function isTextual(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json"
}

function PreviewBody({ url, artifact }: { url: string; artifact: ToolArtifact }) {
  const { mime } = artifact
  if (mime.startsWith("audio/")) return <audio className={styles.media} controls src={url} />
  if (mime.startsWith("video/")) return <video className={styles.media} controls src={url} />
  if (mime.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- 产物字节来自本地 session 端点，无 next/image 优化面
    return <img className={styles.media} src={url} alt={artifact.name} />
  }
  if (mime === "text/html")
    return <iframe className={styles.frame} sandbox="" src={url} title={artifact.name} />
  if (mime === "application/pdf")
    return <iframe className={styles.frame} src={url} title={artifact.name} />
  if (isTextual(mime)) return <TextualPreview url={url} mime={mime} />
  return <p className={styles.note}>该格式暂不支持内嵌预览，请下载查看。</p>
}

export function ArtifactCard({ sessionId, artifact }: { sessionId: string; artifact: ToolArtifact }) {
  // 媒体类默认展开（播放器即入口）；文本类点开才拉字节（懒加载，大文件不拖会话流）。
  const heavy = isTextual(artifact.mime) || artifact.mime === "text/html" || artifact.mime === "application/pdf"
  const [open, setOpen] = useState(!heavy)
  const url = artifactUrl(sessionId, artifact)
  return (
    <div className={styles.card} role="group" aria-label={`产物 ${artifact.name}`}>
      <div className={styles.head}>
        <span className={styles.name}>{artifact.name}</span>
        <span className={styles.meta}>
          {artifact.mime} · {formatBytes(artifact.bytes)}
        </span>
        {heavy ? (
          <button type="button" className={styles.action} onClick={() => setOpen((v) => !v)}>
            {open ? "收起预览" : "预览"}
          </button>
        ) : null}
        <a className={styles.action} href={url} download={artifact.name}>
          下载
        </a>
      </div>
      {open ? <PreviewBody url={url} artifact={artifact} /> : null}
    </div>
  )
}
