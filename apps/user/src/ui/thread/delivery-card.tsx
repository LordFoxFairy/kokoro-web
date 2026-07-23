"use client"

// 会话流尾部成果区：delivery.created 归约出的冻结结论卡（区别于过程文件卡）。
// 点击在 canvas 打开冻结预览；下载走 deliveries 端点的冻结副本。

import { deliveryUrl, formatDeliveryTime } from "@/ui/canvas/canvas-panel"
import type { SessionDelivery } from "@/core/state"
import { fileFetch } from "@/engine/file-fetch"
import { useLocale } from "@/i18n/context"
import { DeliveryIcon } from "@/ui/icons/thread"
import { formatBytes } from "./artifact-card"

import styles from "./delivery-card.module.css"

// 下载走鉴权 fetch → blob（deliveries 端点鉴权开启后 <a href> 直连 401）。
async function downloadDelivery(url: string, name: string): Promise<void> {
  const res = await fileFetch(url)
  if (!res.ok) return
  const objectUrl = URL.createObjectURL(await res.blob())
  const anchor = document.createElement("a")
  anchor.href = objectUrl
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(objectUrl)
}

export function DeliverySection({
  sessionId,
  deliveries,
  onOpen,
}: {
  sessionId: string | null
  deliveries: SessionDelivery[]
  onOpen: (delivery: SessionDelivery) => void
}) {
  const { t, locale } = useLocale()
  if (deliveries.length === 0 || sessionId === null) {
    return null
  }
  return (
    <section className={styles.section} aria-label={t("delivery.heading")}>
      <p className={styles.heading}>{t("delivery.heading")}</p>
      <div className={styles.cards}>
        {deliveries.map((delivery) => (
          <div className={styles.card} key={delivery.contentHash}>
            <button
              type="button"
              className={styles.open}
              aria-label={t("delivery.openAria", { title: delivery.title })}
              onClick={() => onOpen(delivery)}
            >
              <DeliveryIcon className={styles.icon} />
              <span className={styles.body}>
                <span className={styles.title}>{delivery.title}</span>
                <span className={styles.meta}>
                  {formatBytes(delivery.size)} · {formatDeliveryTime(delivery.createdAt, locale)}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={styles.download}
              onClick={() =>
                void downloadDelivery(
                  deliveryUrl(sessionId, delivery.contentHash),
                  delivery.path.split("/").at(-1) ?? delivery.title,
                )
              }
            >
              {t("canvas.download")}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
