"use client"

// 设置浮层（WEB-FACE 面三，rail 用户区默认入口）：居中两栏模态——左分区导航 + 右内容，分区一次显一个
// （tab state）。内容复用 settings-sections（与 /settings 整页同源）。/settings 整页保留作深链兜底。
// 与全站 overlay 面板（skills/mcp/…）同交互：点遮罩关、内容区阻止冒泡、Esc 关。

import { useEffect, useState, type ComponentType } from "react"

import { useT } from "@/i18n/context"
import { CoinIcon, LibraryIcon, SlidersIcon, SunIcon, UsersIcon } from "@/ui/icons/rail"

import {
  AccountCard,
  AppearanceCard,
  CapabilitiesCard,
  ChatPrefsCard,
  SubscriptionCard,
} from "./settings-sections"
import styles from "./settings-panel.module.css"

type SectionKey = "account" | "appearance" | "chat" | "subscription" | "capabilities"

type NavEntry = { key: SectionKey; label: string; Icon: ComponentType<{ className?: string }> }

export function SettingsPanel({ onClose, brandName }: { onClose: () => void; brandName?: string }) {
  const t = useT()
  const [active, setActive] = useState<SectionKey>("account")

  // Esc 关闭（与遮罩点击并列的退出路径；overlay 面板通用交互，此处就地挂载）。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const nav: NavEntry[] = [
    { key: "account", label: t("settings.accountTitle"), Icon: UsersIcon },
    { key: "appearance", label: t("settings.appearanceTitle"), Icon: SunIcon },
    { key: "chat", label: t("settings.chatTitle"), Icon: SlidersIcon },
    { key: "subscription", label: t("settings.subTitle"), Icon: CoinIcon },
    { key: "capabilities", label: t("settings.capsTitle"), Icon: LibraryIcon },
  ]

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        className={styles.panel}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
      >
        <aside className={styles.nav}>
          <div className={styles.navHead}>
            <p className={styles.navTitle}>{t("settings.title")}</p>
            <p className={styles.navBrand}>{brandName ?? "Kokoro"}</p>
          </div>
          <nav className={styles.navList} aria-label={t("settings.title")}>
            {nav.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                className={styles.navItem}
                data-active={active === key}
                aria-current={active === key}
                onClick={() => setActive(key)}
              >
                <span className={styles.navIcon} aria-hidden>
                  <Icon className={styles.navIconSvg} />
                </span>
                {label}
              </button>
            ))}
          </nav>
        </aside>

        <div className={styles.content}>
          <button
            type="button"
            className={styles.close}
            aria-label={t("settings.backToApp")}
            onClick={onClose}
          >
            ×
          </button>
          {/* key 触发切换淡入：每次换分区重挂载 → CSS 入场动画重放。 */}
          <div key={active} className={styles.contentScroll}>
            {active === "account" ? <AccountCard /> : null}
            {active === "appearance" ? <AppearanceCard /> : null}
            {active === "chat" ? <ChatPrefsCard /> : null}
            {active === "subscription" ? <SubscriptionCard /> : null}
            {active === "capabilities" ? <CapabilitiesCard /> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
