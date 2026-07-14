"use client"

// 用户设置整页（WEB-FACE 面三，/settings）：登录后的两栏布局（左分区导航 + 右内容），与管理后台严格
// 分离。分区内容复用 settings-sections（与设置浮层 SettingsPanel 同源，单一真源）。整页保留作深链兜底
// （rail 用户区默认弹 SettingsPanel 浮层）。会话闸：匿名 → 重定向 /login（settings 是登录后面）。

import { useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useT } from "@/i18n/context"
import { CoinIcon, LibraryIcon, SlidersIcon, SunIcon, UsersIcon } from "@/ui/icons/rail"
import { useSessionState } from "@/ui/auth/use-session-state"

import {
  AccountCard,
  AppearanceCard,
  CapabilitiesCard,
  ChatPrefsCard,
  SubscriptionCard,
} from "./settings-sections"
import styles from "./settings-page.module.css"

export function SettingsPage({ brandName }: { brandName?: string }) {
  const t = useT()
  const router = useRouter()
  const sessionState = useSessionState()

  // 匿名闸：探针裁定匿名即回登录页（settings 是登录后面）。
  useEffect(() => {
    if (sessionState === "anonymous") {
      router.replace("/login")
    }
  }, [sessionState, router])

  if (sessionState !== "pass") {
    return null
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <h1 className={styles.pageTitle}>{t("settings.title")}</h1>
        <Link className={styles.backLink} href="/">
          {t("settings.backToApp")}
        </Link>
      </header>
      <div className={styles.shell}>
        <nav className={styles.nav} aria-label={t("settings.title")}>
          <a className={styles.navItem} href="#sec-account">
            <span className={styles.navIcon} aria-hidden><UsersIcon className={styles.navIconSvg} /></span>
            {t("settings.accountTitle")}
          </a>
          <a className={styles.navItem} href="#sec-appearance">
            <span className={styles.navIcon} aria-hidden><SunIcon className={styles.navIconSvg} /></span>
            {t("settings.appearanceTitle")}
          </a>
          <a className={styles.navItem} href="#sec-chat">
            <span className={styles.navIcon} aria-hidden><SlidersIcon className={styles.navIconSvg} /></span>
            {t("settings.chatTitle")}
          </a>
          <a className={styles.navItem} href="#sec-subscription">
            <span className={styles.navIcon} aria-hidden><CoinIcon className={styles.navIconSvg} /></span>
            {t("settings.subTitle")}
          </a>
          <a className={styles.navItem} href="#sec-capabilities">
            <span className={styles.navIcon} aria-hidden><LibraryIcon className={styles.navIconSvg} /></span>
            {t("settings.capsTitle")}
          </a>
          <p className={styles.navBrand} aria-hidden>
            {brandName ?? "Kokoro"}
          </p>
        </nav>
        <main className={styles.stack}>
          <div id="sec-account" className={styles.anchor}>
            <AccountCard />
          </div>
          <div id="sec-appearance" className={styles.anchor}>
            <AppearanceCard />
          </div>
          <div id="sec-chat" className={styles.anchor}>
            <ChatPrefsCard />
          </div>
          <div id="sec-subscription" className={styles.anchor}>
            <SubscriptionCard />
          </div>
          <div id="sec-capabilities" className={styles.anchor}>
            <CapabilitiesCard />
          </div>
        </main>
      </div>
    </div>
  )
}
