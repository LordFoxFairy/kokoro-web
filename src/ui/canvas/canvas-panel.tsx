"use client"

// 右侧 canvas 工作区面板：会话在左、内容在右（三栏第三栏）。
// 内容体按来源分派：file=可变直读（重开即最新）、delivery=冻结成果（hash 寻址）、
// tool=参数/结果详情、node=通用 ReactNode 插槽；文本预览复用格式矩阵。

import { useState } from "react"

import { deliveryPath, filePath } from "@/contract/http"
import { sessionBaseUrl } from "@/engine/config"
import { fileFetch } from "@/engine/file-fetch"
import type { SessionDelivery, WorkspaceFileEntry } from "@/core/state"
import { useLocale } from "@/i18n/context"
import { PreviewBody, formatBytes } from "@/ui/thread/artifact-card"
import { DeliveryIcon } from "@/ui/icons/thread"

import type { ResolvedCanvasContent } from "./canvas-store"
import styles from "./canvas-panel.module.css"

export function fileUrl(sessionId: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  return `${sessionBaseUrl()}${filePath(sessionId, "__P__")}`.replace("__P__", encoded)
}

export function deliveryUrl(sessionId: string, contentHash: string): string {
  return `${sessionBaseUrl()}${deliveryPath(sessionId, encodeURIComponent(contentHash))}`
}

// 下载走鉴权 fetch → blob（<a href> 直连端点鉴权开启后 401）。
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

function isTextual(mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json"
}

export function formatDeliveryTime(iso: string, locale: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString(locale === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

// 工具参数压成紧凑 JSON；空参数返回 null（不渲染参数块）。
function formatToolArgs(args: Record<string, unknown>): string | null {
  const keys = Object.keys(args)
  if (keys.length === 0) return null
  try {
    return JSON.stringify(args, null, 2)
  } catch {
    return keys.join(", ")
  }
}

function contentTitle(content: ResolvedCanvasContent): string {
  switch (content.kind) {
    case "file":
      return content.file.path
    case "delivery":
      return content.delivery.title
    case "tool":
      return content.tool.name
    case "node":
      return content.title
  }
}

export function CanvasPanel({
  sessionId,
  content,
  files,
  deliveries,
  fullscreen,
  onSelectFile,
  onSelectDelivery,
  onToggleFullscreen,
  onClose,
}: {
  sessionId: string
  content: ResolvedCanvasContent
  // 工作区清单（snapshot 水合）：面板内「文件」tab 浏览并切换预览；成果分组并列。
  files: WorkspaceFileEntry[]
  deliveries: SessionDelivery[]
  fullscreen: boolean
  onSelectFile: (file: WorkspaceFileEntry) => void
  onSelectDelivery: (delivery: SessionDelivery) => void
  onToggleFullscreen: () => void
  onClose: () => void
}) {
  const { t, locale } = useLocale()
  const [view, setView] = useState<"preview" | "list">("preview")
  const title = contentTitle(content)

  // 下载入口按来源取 URL：file=可变当前态；delivery=冻结副本。tool/node 无下载面。
  const download =
    content.kind === "file"
      ? {
          url: fileUrl(sessionId, content.file.path),
          name: content.file.path.split("/").at(-1) ?? content.file.path,
        }
      : content.kind === "delivery"
        ? {
            url: deliveryUrl(sessionId, content.delivery.contentHash),
            name: content.delivery.path.split("/").at(-1) ?? content.delivery.title,
          }
        : null

  const meta =
    content.kind === "file"
      ? `${content.file.mime} · ${formatBytes(content.file.bytes)}`
      : content.kind === "delivery"
        ? `${content.delivery.mime} · ${formatBytes(content.delivery.size)} · ${formatDeliveryTime(content.delivery.createdAt, locale)}`
        : null

  return (
    <aside
      className={styles.panel}
      data-fullscreen={fullscreen ? "true" : undefined}
      aria-label={t("canvas.detailAria", { title })}
    >
      <header className={styles.head}>
        <button
          type="button"
          className={styles.action}
          onClick={() => setView(view === "list" ? "preview" : "list")}
        >
          {view === "list" ? t("canvas.previewTab") : t("canvas.filesTab")}
        </button>
        <span className={styles.name} title={title}>
          {view === "list" ? t("canvas.filesHeading") : title}
        </span>
        {view === "preview" && meta !== null ? (
          <span className={styles.meta}>{meta}</span>
        ) : null}
        <span className={styles.actions}>
          {view === "preview" && download !== null ? (
            <button
              type="button"
              className={styles.action}
              onClick={() => void downloadFile(download.url, download.name)}
            >
              {t("canvas.download")}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.action}
            onClick={onToggleFullscreen}
            aria-pressed={fullscreen}
          >
            {fullscreen ? t("canvas.exitFullscreen") : t("canvas.fullscreen")}
          </button>
          <button
            type="button"
            className={styles.action}
            onClick={onClose}
            aria-label={t("canvas.closePreview")}
          >
            {t("canvas.close")}
          </button>
        </span>
      </header>
      <div className={styles.body}>
        {view === "list" ? (
          <WorkspaceList
            files={files}
            deliveries={deliveries}
            locale={locale}
            onSelectFile={(file) => {
              onSelectFile(file)
              setView("preview")
            }}
            onSelectDelivery={(delivery) => {
              onSelectDelivery(delivery)
              setView("preview")
            }}
          />
        ) : (
          <ContentBody sessionId={sessionId} content={content} />
        )}
      </div>
    </aside>
  )
}

function WorkspaceList({
  files,
  deliveries,
  locale,
  onSelectFile,
  onSelectDelivery,
}: {
  files: WorkspaceFileEntry[]
  deliveries: SessionDelivery[]
  locale: string
  onSelectFile: (file: WorkspaceFileEntry) => void
  onSelectDelivery: (delivery: SessionDelivery) => void
}) {
  const { t } = useLocale()
  return (
    <div className={styles.listing}>
      {/* 成果分组：冻结结论置顶——「拿走什么」优先于「过程文件」。 */}
      <p className={styles.groupHeading}>{t("canvas.deliveriesHeading")}</p>
      {deliveries.length === 0 ? (
        <p className={styles.meta}>{t("canvas.deliveriesEmpty")}</p>
      ) : (
        <ul className={styles.tree}>
          {deliveries.map((delivery) => (
            <li key={delivery.contentHash}>
              <button
                type="button"
                className={styles.treeItem}
                onClick={() => onSelectDelivery(delivery)}
              >
                <span className={styles.treeName}>
                  <DeliveryIcon className={styles.treeIcon} />
                  {delivery.title}
                </span>
                <span className={styles.meta}>
                  {formatBytes(delivery.size)} · {formatDeliveryTime(delivery.createdAt, locale)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.groupHeading}>{t("canvas.filesHeading")}</p>
      {files.length === 0 ? (
        <p className={styles.meta}>{t("canvas.empty")}</p>
      ) : (
        <ul className={styles.tree}>
          {files.map((entry) => (
            <li key={entry.path}>
              <button
                type="button"
                className={styles.treeItem}
                onClick={() => onSelectFile(entry)}
              >
                <span>{entry.path}</span>
                <span className={styles.meta}>{formatBytes(entry.bytes)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ContentBody({
  sessionId,
  content,
}: {
  sessionId: string
  content: ResolvedCanvasContent
}) {
  const { t } = useLocale()
  switch (content.kind) {
    case "file": {
      const name = content.file.path.split("/").at(-1) ?? content.file.path
      return (
        <PreviewBody
          url={fileUrl(sessionId, content.file.path)}
          mime={content.file.mime}
          name={name}
        />
      )
    }
    case "delivery": {
      const { delivery } = content
      // 成果预览：文本类直显（冻结字节）；其它格式给下载态，不做媒体内嵌。
      return (
        <div className={styles.deliveryBody}>
          {delivery.note !== undefined && delivery.note !== "" ? (
            <p className={styles.deliveryNote}>{delivery.note}</p>
          ) : null}
          {isTextual(delivery.mime) ? (
            <PreviewBody
              url={deliveryUrl(sessionId, delivery.contentHash)}
              mime={delivery.mime}
              name={delivery.title}
            />
          ) : (
            <p className={styles.meta}>{t("artifact.unsupported")}</p>
          )}
        </div>
      )
    }
    case "tool": {
      const { tool } = content
      const args = formatToolArgs(tool.args)
      const hasResult = typeof tool.result === "string" && tool.result.length > 0
      return (
        <div className={styles.toolBody} data-status={tool.status}>
          {args !== null ? (
            <>
              <p className={styles.groupHeading}>{t("canvas.toolArgs")}</p>
              <pre className={styles.toolBlock}>{args}</pre>
            </>
          ) : null}
          {hasResult ? (
            <>
              <p className={styles.groupHeading}>{t("canvas.toolResult")}</p>
              <pre className={styles.toolBlock} data-error={tool.status === "error" ? "true" : undefined}>
                {tool.result}
              </pre>
            </>
          ) : null}
          {args === null && !hasResult ? (
            <p className={styles.meta}>{t("canvas.toolNoDetail")}</p>
          ) : null}
        </div>
      )
    }
    case "node":
      return <>{content.node}</>
  }
}
