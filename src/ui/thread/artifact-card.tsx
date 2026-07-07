"use client"

// 产物预览卡：按 MIME 主类分派的全格式矩阵；文本类懒加载（点开才拉字节），媒体类浏览器原生流式。

import { useEffect, useState } from "react"

import { fileFetch, useFileBlob } from "@/engine/file-fetch"
import { useT } from "@/i18n/context"

import { MarkdownMessage } from "./markdown-message"

import styles from "./artifact-card.module.css"

const TEXT_PREVIEW_MAX_BYTES = 64 * 1024
const CSV_PREVIEW_MAX_ROWS = 200

export function formatBytes(count: number): string {
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
    void fileFetch(url)
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
  const t = useT()
  const preview = useTextPreview(url, true)
  if (preview.kind === "loading") return <p className={styles.note}>{t("artifact.loadingPreview")}</p>
  if (preview.kind === "failed") return <p className={styles.note}>{t("artifact.cannotPreview")}</p>
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
      {preview.truncated ? <p className={styles.note}>{t("artifact.truncated")}</p> : null}
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

function isMedia(mime: string): boolean {
  return (
    mime.startsWith("audio/") ||
    mime.startsWith("video/") ||
    mime.startsWith("image/") ||
    mime === "text/html" ||
    mime === "application/pdf"
  )
}

// 媒体/iframe：src 带不了 Authorization，故鉴权 fetch 成 object URL 再喂 src（鉴权开启后避 401）。
function MediaPreview({ url, mime, name }: { url: string; mime: string; name: string }) {
  const t = useT()
  const blob = useFileBlob(url, true)
  if (blob.kind === "loading") return <p className={styles.note}>{t("artifact.loadingPreview")}</p>
  if (blob.kind === "failed") return <p className={styles.note}>{t("artifact.cannotPreview")}</p>
  const src = blob.objectUrl
  if (mime.startsWith("audio/")) return <audio className={styles.media} controls src={src} />
  if (mime.startsWith("video/")) return <video className={styles.media} controls src={src} />
  if (mime.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- 产物字节=本地 session 端点鉴权拉取的 blob，无 next/image 面
    return <img className={styles.media} src={src} alt={name} />
  }
  if (mime === "text/html")
    return <iframe className={styles.frame} sandbox="" src={src} title={name} />
  return <iframe className={styles.frame} src={src} title={name} />
}

export function PreviewBody({ url, mime, name }: { url: string; mime: string; name: string }) {
  const t = useT()
  if (isTextual(mime)) return <TextualPreview url={url} mime={mime} />
  if (isMedia(mime)) return <MediaPreview url={url} mime={mime} name={name} />
  return <p className={styles.note}>{t("artifact.unsupported")}</p>
}

export function FileChip({ path, onOpen }: { path: string; onOpen: () => void }) {
  // 路径即入口（manus/codex 心智）：write_file 等工具行的文件名可点，canvas 打开预览。
  const name = path.split("/").at(-1) ?? path
  return (
    <button type="button" className={styles.chip} onClick={onOpen}>
      <span className={styles.chipName}>{name}</span>
    </button>
  )
}
