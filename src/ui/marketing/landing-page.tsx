"use client"

// 营销落地页（WEB-FACE 面一）：未登录访客的 `/` 首页。IA 对标参考骨架：共用顶栏 → Hero（大标题 +
// 巨型 prompt 输入作 CTA + 能力 chip 行）→ 能力区（图文左右交替，真实能力 + 抽象插画位，不放假截图）
// → FAQ 手风琴（原生 details，无 JS）→ 深色 CTA 块 → 深色多列页脚（只挂真实目的地：页内锚 + /login）。
// 皮肤守 Kokoro 暖纸 --k-* 体系，亮暗双态。hero 输入回车即暂存草稿并跳 /login，登录回跳后 composer 预填。

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { useT } from "@/i18n/context"
import type { MessageKey } from "@/i18n/messages"
import { stashPendingDraft } from "@/ui/shell/use-draft"

import { MarketingTopBar } from "./marketing-top-bar"
import styles from "./landing-page.module.css"

// 能力区原创彩色插画（成套，每张贴一个能力语义）：暖纸风 + 品牌木色 + 一组柔和 pastel accent，
// 有色彩、细节与层次——本仓自绘 SVG，非任何第三方素材。variant 决定场景。
function CapabilityArt({ variant }: { variant: number }) {
  return (
    <svg className={styles.capArt} viewBox="0 0 200 150" role="img" aria-hidden data-variant={variant}>
      {/* 每张一层柔和场景底色（pastel 晕染），再叠白卡与主题元素。 */}
      <rect className={styles.capScene} x="0" y="0" width="200" height="150" rx="16" />
      {variant === 0 ? (
        // 对话协作 + HITL 审批：两枚对话气泡 + 审批勾徽标。
        <>
          <circle className={styles.capBlobPink} cx="150" cy="34" r="40" />
          <rect className={styles.capCard} x="26" y="30" width="96" height="34" rx="10" />
          <rect className={styles.capMuted} x="38" y="41" width="60" height="5" rx="2.5" />
          <rect className={styles.capMuted} x="38" y="51" width="42" height="5" rx="2.5" />
          <rect className={styles.capInk} x="92" y="78" width="82" height="34" rx="10" />
          <rect className={styles.capOn} x="104" y="89" width="52" height="5" rx="2.5" />
          <rect className={styles.capOn} x="104" y="99" width="34" height="5" rx="2.5" />
          <circle className={styles.capAccentGreen} cx="150" cy="66" r="15" />
          <path className={styles.capCheck} d="M143 66 l5 5 l9 -10" />
        </>
      ) : variant === 1 ? (
        // 技能库：模块化技能卡网格 + 高亮一枚 + 新增位。
        <>
          <circle className={styles.capBlobAmber} cx="46" cy="120" r="42" />
          <rect className={styles.capCard} x="30" y="28" width="46" height="40" rx="9" />
          <rect className={styles.capInk} x="86" y="28" width="46" height="40" rx="9" />
          <rect className={styles.capCard} x="142" y="28" width="30" height="40" rx="9" />
          <rect className={styles.capCard} x="30" y="82" width="46" height="40" rx="9" />
          <rect className={styles.capCard} x="86" y="82" width="46" height="40" rx="9" />
          <rect className={styles.capAccentBlueFill} x="142" y="82" width="30" height="40" rx="9" />
          <rect className={styles.capMuted} x="40" y="45" width="26" height="5" rx="2.5" />
          <rect className={styles.capOn} x="96" y="45" width="26" height="5" rx="2.5" />
          <path className={styles.capCheckThin} d="M151 102 h12 M157 96 v12" />
        </>
      ) : variant === 2 ? (
        // 连接 MCP：中心枢纽节点连接三个工具节点。
        <>
          <circle className={styles.capBlobBlue} cx="100" cy="40" r="46" />
          <path className={styles.capLink} d="M100 75 L48 40 M100 75 L152 40 M100 75 L100 118" />
          <circle className={styles.capInk} cx="100" cy="75" r="18" />
          <circle className={styles.capOnDot} cx="100" cy="75" r="6" />
          <rect className={styles.capAccentPinkFill} x="34" y="26" width="28" height="28" rx="8" />
          <rect className={styles.capAccentAmberFill} x="138" y="26" width="28" height="28" rx="8" />
          <rect className={styles.capAccentGreenFill} x="86" y="106" width="28" height="28" rx="8" />
        </>
      ) : variant === 3 ? (
        // 成果交付 / 分享：产物文档 + 分享链接徽标。
        <>
          <circle className={styles.capBlobGreen} cx="150" cy="118" r="42" />
          <rect className={styles.capCard} x="40" y="24" width="86" height="102" rx="12" />
          <rect className={styles.capMuted} x="54" y="40" width="58" height="6" rx="3" />
          <rect className={styles.capMuted} x="54" y="56" width="40" height="6" rx="3" />
          <rect className={styles.capAccentAmberFill} x="54" y="76" width="58" height="36" rx="7" />
          <circle className={styles.capInk} cx="140" cy="52" r="18" />
          <path className={styles.capShare} d="M134 52 h12 M141 47 l6 5 l-6 5" />
        </>
      ) : variant === 4 ? (
        // 团队协作：共享工作区 + 三枚成员头像。
        <>
          <circle className={styles.capBlobPink} cx="52" cy="40" r="44" />
          <rect className={styles.capCard} x="30" y="46" width="140" height="76" rx="12" />
          <rect className={styles.capMuted} x="44" y="60" width="70" height="6" rx="3" />
          <rect className={styles.capMuted} x="44" y="74" width="112" height="6" rx="3" />
          <rect className={styles.capAccentBlueFill} x="44" y="94" width="48" height="16" rx="8" />
          <circle className={styles.capAvatarInk} cx="78" cy="34" r="16" />
          <circle className={styles.capAvatarAmber} cx="104" cy="34" r="16" />
          <circle className={styles.capAvatarPink} cx="130" cy="34" r="16" />
        </>
      ) : (
        // 多模型：模型选择器 + 一枚激活 chip。
        <>
          <circle className={styles.capBlobBlue} cx="150" cy="118" r="42" />
          <rect className={styles.capCard} x="34" y="40" width="132" height="70" rx="14" />
          <rect className={styles.capInk} x="46" y="58" width="52" height="34" rx="9" />
          <rect className={styles.capOn} x="58" y="72" width="28" height="6" rx="3" />
          <rect className={styles.capAccentAmberFill} x="106" y="58" width="24" height="34" rx="9" />
          <rect className={styles.capAccentPinkFill} x="136" y="58" width="24" height="34" rx="9" />
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

// Hero 能力 chip（对标参考输入框下的能力 tab 行）：锚到能力区的真实能力短标签，非产品下拉。
const HERO_CHIPS: readonly MessageKey[] = [
  "marketing.chipChat",
  "marketing.chipSkills",
  "marketing.chipMcp",
  "marketing.chipDeliver",
  "marketing.chipTeam",
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
  const brand = brandName ?? "Kokoro"

  // magic-link 回调失败 303 落在 `/?auth=link_unavailable`（callback 机制不改）：转投 /login，
  // 由登录页统一 toast 提示重发。落地页本身不承载登录错误 UI。
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("auth") === "link_unavailable") {
      router.replace("/login?auth=link_unavailable")
    }
  }, [router])

  // hero 输入回车/点开始：暂存草稿到 pending 键 → 跳 /login；登录回跳 `/` 后 composer 读同键预填。
  const startFromHero = (): void => {
    const value = heroDraft.trim()
    if (value !== "") {
      stashPendingDraft(value)
    }
    router.push("/login")
  }

  return (
    <div className={styles.page}>
      <MarketingTopBar brandName={brand} />

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
              aria-label={t("marketing.heroStart")}
              data-testid="landing-hero-start"
            >
              <span className={styles.heroSubmitText}>{t("marketing.heroStart")}</span>
              <span className={styles.heroSubmitArrow} aria-hidden>
                →
              </span>
            </button>
          </div>
          <div className={styles.heroChips}>
            {HERO_CHIPS.map((chip) => (
              <a key={chip} className={styles.heroChip} href="#capabilities">
                {t(chip)}
              </a>
            ))}
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
      </main>

      <section className={styles.ctaBlock}>
        <div className={styles.ctaInner}>
          <h2 className={styles.ctaTitle}>{t("marketing.ctaTitle")}</h2>
          <p className={styles.ctaBody}>{t("marketing.ctaBody")}</p>
          <Link className={styles.ctaButton} href="/login">
            {t("marketing.ctaButton")}
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footInner}>
          <div className={styles.footBrandCol}>
            <div className={styles.footBrand}>
              <span className={styles.footBrandMark} aria-hidden>
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M12 20.5s-7.4-4.6-9.6-9C1.1 8.7 2.3 5.4 5.4 4.7c2-.45 3.9.55 4.9 2.2l1.7 2.8 1.7-2.8c1-1.65 2.9-2.65 4.9-2.2 3.1.7 4.3 4 2.99 6.8-2.19 4.4-9.59 9-9.59 9z" />
                </svg>
              </span>
              <span className={styles.footBrandName}>{brand}</span>
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
        </div>
        <p className={styles.footRights}>
          © {new Date().getFullYear()} {brand}. {t("marketing.footRights")}
        </p>
      </footer>
    </div>
  )
}
