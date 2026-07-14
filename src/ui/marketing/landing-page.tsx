"use client"

// 营销落地页（WEB-FACE 面一）：未登录访客的 `/` 首页。IA=顶栏 → Hero（prompt 风格输入作 CTA）
// → 能力区（左右交替，真实能力+抽象插画位，不放假截图）→ FAQ 手风琴（原生 details，无 JS）
// → 深色 CTA 块 → 多列页脚（只挂真实目的地：页内锚 + /login）。皮肤守 Kokoro 暖纸 --k-* 体系，
// 亮暗双态随 globals.css。hero 输入回车即暂存草稿并跳 /login，登录回跳后 composer 预填。

import { useState, type ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"
import { stashPendingDraft } from "@/ui/shell/use-draft"

import styles from "./landing-page.module.css"

// 品牌「心」标（Kokoro=心）：暖木填充实心心形，非可翻译文案（与登录/壳同源）。
function HeartMark() {
  return (
    <svg className={styles.heartMark} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 20.5s-7.4-4.6-9.6-9C1.1 8.7 2.3 5.4 5.4 4.7c2-.45 3.9.55 4.9 2.2l1.7 2.8 1.7-2.8c1-1.65 2.9-2.65 4.9-2.2 3.1.7 4.3 4 2.99 6.8-2.19 4.4-9.59 9-9.59 9z" />
    </svg>
  )
}

// 能力区抽象插画：暖纸底上的几何母题（非产品截图，避免造假素材）。variant 决定构图。
function CapabilityArt({ variant }: { variant: number }) {
  return (
    <svg className={styles.capArt} viewBox="0 0 120 90" aria-hidden data-variant={variant}>
      <rect className={styles.capArtBase} x="8" y="10" width="104" height="70" rx="10" />
      {variant === 0 ? (
        <>
          <rect className={styles.capArtSoft} x="20" y="24" width="52" height="8" rx="4" />
          <rect className={styles.capArtSoft} x="20" y="40" width="72" height="8" rx="4" />
          <rect className={styles.capArtInk} x="20" y="58" width="30" height="10" rx="5" />
        </>
      ) : variant === 1 ? (
        <>
          <circle className={styles.capArtInk} cx="34" cy="34" r="9" />
          <circle className={styles.capArtSoft} cx="60" cy="34" r="9" />
          <circle className={styles.capArtSoft} cx="86" cy="34" r="9" />
          <rect className={styles.capArtSoft} x="24" y="54" width="72" height="8" rx="4" />
        </>
      ) : variant === 2 ? (
        <>
          <circle className={styles.capArtInk} cx="34" cy="45" r="8" />
          <circle className={styles.capArtInk} cx="86" cy="45" r="8" />
          <path className={styles.capArtStroke} d="M42 45 H78" />
          <rect className={styles.capArtSoft} x="24" y="24" width="72" height="6" rx="3" />
        </>
      ) : variant === 3 ? (
        <>
          <path className={styles.capArtStroke} d="M28 60 L52 36 L70 50 L92 26" />
          <circle className={styles.capArtInk} cx="92" cy="26" r="5" />
        </>
      ) : variant === 4 ? (
        <>
          <circle className={styles.capArtInk} cx="46" cy="40" r="10" />
          <circle className={styles.capArtSoft} cx="72" cy="40" r="10" />
          <rect className={styles.capArtSoft} x="30" y="60" width="60" height="7" rx="3.5" />
        </>
      ) : (
        <>
          <rect className={styles.capArtInk} x="22" y="26" width="30" height="38" rx="6" />
          <rect className={styles.capArtSoft} x="60" y="26" width="30" height="38" rx="6" />
        </>
      )}
    </svg>
  )
}

type Capability = { title: MessageKey; body: MessageKey }

const CAPABILITIES: readonly Capability[] = [
  { title: "marketing.capChatTitle", body: "marketing.capChatBody" },
  { title: "marketing.capSkillsTitle", body: "marketing.capSkillsBody" },
  { title: "marketing.capMcpTitle", body: "marketing.capMcpBody" },
  { title: "marketing.capDeliverTitle", body: "marketing.capDeliverBody" },
  { title: "marketing.capTeamTitle", body: "marketing.capTeamBody" },
  { title: "marketing.capModelTitle", body: "marketing.capModelBody" },
]

type Faq = { q: MessageKey; a: MessageKey }

const FAQS: readonly Faq[] = [
  { q: "marketing.faqBillingQ", a: "marketing.faqBillingA" },
  { q: "marketing.faqDataQ", a: "marketing.faqDataA" },
  { q: "marketing.faqTeamQ", a: "marketing.faqTeamA" },
  { q: "marketing.faqMcpQ", a: "marketing.faqMcpA" },
]

export function LandingPage({ brandName }: { brandName?: string }) {
  const t = useT()
  const router = useRouter()
  const [heroDraft, setHeroDraft] = useState("")
  const [navOpen, setNavOpen] = useState(false)
  const brand = brandName ?? "Kokoro"

  // hero 输入回车/点开始：暂存草稿到 pending 键 → 跳 /login；登录回跳 `/` 后 composer 读同键预填。
  const startFromHero = (): void => {
    const value = heroDraft.trim()
    if (value !== "") {
      stashPendingDraft(value)
    }
    router.push("/login")
  }

  const navLinks: ReactNode = (
    <>
      <a className={styles.navLink} href="#faq" onClick={() => setNavOpen(false)}>
        {t("marketing.navPricing")}
      </a>
      <Link className={styles.navLink} href="/login" onClick={() => setNavOpen(false)}>
        {t("marketing.navLogin")}
      </Link>
      <Link className={styles.navCta} href="/login" onClick={() => setNavOpen(false)}>
        {t("marketing.navCta")}
      </Link>
    </>
  )

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label={brand}>
          <span className={styles.brandMark} aria-hidden>
            <HeartMark />
          </span>
          <span className={styles.brandName}>{brand}</span>
        </Link>
        <nav className={styles.navDesktop} aria-label={brand}>
          {navLinks}
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
          {navLinks}
        </nav>
      ) : null}

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.heroTitle}>{t("marketing.heroTitle")}</h1>
          <p className={styles.heroSubtitle}>{t("marketing.heroSubtitle")}</p>
          <div className={styles.heroInputRow}>
            <input
              className={styles.heroInput}
              value={heroDraft}
              placeholder={t("marketing.heroInputPlaceholder")}
              aria-label={t("marketing.heroInputAria")}
              onChange={(event) => setHeroDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  startFromHero()
                }
              }}
              data-testid="landing-hero-input"
            />
            <button
              type="button"
              className={styles.heroSubmit}
              onClick={startFromHero}
              data-testid="landing-hero-start"
            >
              {t("marketing.heroStart")}
            </button>
          </div>
          <p className={styles.heroNote}>{t("marketing.heroNote")}</p>
        </section>

        <section className={styles.caps} id="capabilities">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t("marketing.capsHeading")}</h2>
            <p className={styles.sectionSub}>{t("marketing.capsSubheading")}</p>
          </div>
          <div className={styles.capList}>
            {CAPABILITIES.map((cap, index) => (
              <article
                key={cap.title}
                className={styles.capRow}
                data-flip={index % 2 === 1 ? "true" : undefined}
              >
                <div className={styles.capArtWrap}>
                  <CapabilityArt variant={index} />
                </div>
                <div className={styles.capText}>
                  <h3 className={styles.capTitle}>{t(cap.title)}</h3>
                  <p className={styles.capBody}>{t(cap.body)}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.faq} id="faq">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t("marketing.faqHeading")}</h2>
          </div>
          <div className={styles.faqList}>
            {FAQS.map((item) => (
              <details key={item.q} className={styles.faqItem}>
                <summary className={styles.faqQuestion}>
                  <span>{t(item.q)}</span>
                  <span className={styles.faqChevron} aria-hidden>
                    +
                  </span>
                </summary>
                <p className={styles.faqAnswer}>{t(item.a)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className={styles.ctaBlock}>
          <h2 className={styles.ctaTitle}>{t("marketing.ctaTitle")}</h2>
          <p className={styles.ctaBody}>{t("marketing.ctaBody")}</p>
          <Link className={styles.ctaButton} href="/login">
            {t("marketing.ctaButton")}
          </Link>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footBrandCol}>
          <div className={styles.brand}>
            <span className={styles.brandMark} aria-hidden>
              <HeartMark />
            </span>
            <span className={styles.brandName}>{brand}</span>
          </div>
          <p className={styles.footTagline}>{t("marketing.footTagline")}</p>
        </div>
        <nav className={styles.footCol} aria-label={t("marketing.footProduct")}>
          <p className={styles.footColHead}>{t("marketing.footProduct")}</p>
          <a className={styles.footLink} href="#capabilities">
            {t("marketing.footLinkCaps")}
          </a>
          <a className={styles.footLink} href="#faq">
            {t("marketing.footLinkFaq")}
          </a>
          <Link className={styles.footLink} href="/login">
            {t("marketing.footLinkLogin")}
          </Link>
        </nav>
        <p className={styles.footRights}>
          © {new Date().getFullYear()} {brand}. {t("marketing.footRights")}
        </p>
      </footer>
    </div>
  )
}
