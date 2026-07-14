"use client"

// 营销/登录共用顶栏（WEB-FACE）：品牌（SITE-REAL 注入）左，导航 + 强调 CTA 右；桌面横排、
// 移动收汉堡下拉。落地页与登录页共用同一顶栏骨架，保证结构一致。honest：只挂真实目的地
// （定价锚 + /login），不造不存在的产品下拉。

import { useState } from "react"
import Link from "next/link"

import { useT } from "@/i18n/context"

import styles from "./marketing-top-bar.module.css"

// 品牌「心」标（Kokoro=心）：暖木填充实心心形，非可翻译文案。
function HeartMark() {
  return (
    <svg className={styles.heartMark} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 20.5s-7.4-4.6-9.6-9C1.1 8.7 2.3 5.4 5.4 4.7c2-.45 3.9.55 4.9 2.2l1.7 2.8 1.7-2.8c1-1.65 2.9-2.65 4.9-2.2 3.1.7 4.3 4 2.99 6.8-2.19 4.4-9.59 9-9.59 9z" />
    </svg>
  )
}

export function MarketingTopBar({ brandName }: { brandName?: string }) {
  const t = useT()
  const brand = brandName ?? "Kokoro"
  const [navOpen, setNavOpen] = useState(false)

  const links = (
    <>
      <Link className={styles.navLink} href="/#faq" onClick={() => setNavOpen(false)}>
        {t("marketing.navPricing")}
      </Link>
      <Link className={styles.navLink} href="/login" onClick={() => setNavOpen(false)}>
        {t("marketing.navLogin")}
      </Link>
      <Link className={styles.navCta} href="/login" onClick={() => setNavOpen(false)}>
        {t("marketing.navCta")}
      </Link>
    </>
  )

  return (
    <>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label={brand}>
          <span className={styles.brandMark} aria-hidden>
            <HeartMark />
          </span>
          <span className={styles.brandName}>{brand}</span>
        </Link>
        <nav className={styles.navDesktop} aria-label={brand}>
          {links}
        </nav>
        <button
          type="button"
          className={styles.navToggle}
          aria-label={navOpen ? t("marketing.navClose") : t("marketing.navOpen")}
          aria-expanded={navOpen}
          onClick={() => setNavOpen((open) => !open)}
        >
          <span aria-hidden>{navOpen ? "×" : "☰"}</span>
        </button>
      </header>
      {navOpen ? (
        <nav className={styles.navMobile} aria-label={brand}>
          {links}
        </nav>
      ) : null}
    </>
  )
}
