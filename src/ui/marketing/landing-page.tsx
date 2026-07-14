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

// 能力区原创插画（成套，每张模拟一段真实界面片段，一眼看懂对应能力）：暖纸风 + 品牌木色 +
// 柔和 pastel accent + 柔和投影，多层次。本仓自绘 SVG，非任何第三方素材。variant 决定场景。
function CapabilityArt({ variant }: { variant: number }) {
  return (
    <svg className={styles.capArt} viewBox="0 0 220 160" role="img" aria-hidden data-variant={variant}>
      {/* 场景底色 pastel 晕染。 */}
      <rect className={styles.capScene} x="0" y="0" width="220" height="160" rx="18" />
      {variant === 0 ? (
        // 对话即协作 + HITL 审批：消息气泡 + 「通过/驳回」审批按钮组。
        <>
          <circle className={styles.capBlobPink} cx="172" cy="30" r="46" />
          <g className={styles.capElevated}>
            <rect className={styles.capCard} x="20" y="22" width="180" height="116" rx="14" />
          </g>
          <rect className={styles.capMuted} x="34" y="38" width="70" height="9" rx="4.5" />
          <rect className={styles.capMuted} x="34" y="52" width="46" height="9" rx="4.5" />
          <rect className={styles.capInk} x="112" y="70" width="74" height="26" rx="9" />
          <rect className={styles.capOn} x="123" y="79" width="42" height="8" rx="4" />
          {/* 审批按钮组：通过（绿实心+勾）/ 驳回（描边+叉）。 */}
          <rect className={styles.capBtnGreen} x="34" y="106" width="74" height="22" rx="11" />
          <path className={styles.capBtnGlyphOn} d="M46 117 l5 5 l9 -10" />
          <rect className={styles.capMuted} x="60" y="113" width="38" height="8" rx="4" />
          <rect className={styles.capBtnOutline} x="118" y="106" width="68" height="22" rx="11" />
          <path className={styles.capBtnGlyphInk} d="M130 111 l10 12 M140 111 l-10 12" />
          <rect className={styles.capMutedSoft} x="146" y="113" width="34" height="8" rx="4" />
        </>
      ) : variant === 1 ? (
        // 技能库：带图标的技能卡列表 + 固定/启用态。
        <>
          <circle className={styles.capBlobAmber} cx="40" cy="150" r="46" />
          <g className={styles.capElevated}>
            <rect className={styles.capCard} x="22" y="20" width="176" height="120" rx="14" />
          </g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                className={i === 1 ? styles.capRowActive : styles.capRowIdle}
                x="34"
                y={32 + i * 34}
                width="152"
                height="26"
                rx="8"
              />
              <rect
                className={i === 0 ? styles.capIconAmber : i === 1 ? styles.capIconInk : styles.capIconBlue}
                x="42"
                y={37 + i * 34}
                width="16"
                height="16"
                rx="5"
              />
              <rect className={styles.capMuted} x="66" y={41 + i * 34} width="66" height="7" rx="3.5" />
              {i === 1 ? (
                <path className={styles.capPin} d="M170 40 l0 12 M164 46 l12 0" />
              ) : (
                <rect className={styles.capMutedSoft} x="160" y={42 + i * 34} width="18" height="7" rx="3.5" />
              )}
            </g>
          ))}
        </>
      ) : variant === 2 ? (
        // 连接 MCP：中心枢纽 + 三个服务节点带在线状态点。
        <>
          <circle className={styles.capBlobBlue} cx="110" cy="34" r="52" />
          <path className={styles.capLink} d="M110 84 L52 44 M110 84 L168 44 M110 84 L110 128" />
          <g className={styles.capElevated}>
            <circle className={styles.capInk} cx="110" cy="84" r="22" />
          </g>
          <circle className={styles.capOnDot} cx="110" cy="84" r="7" />
          {/* 服务节点（圆角方 + 右上角在线绿点）。 */}
          <g className={styles.capElevated}>
            <rect className={styles.capAccentPinkFill} x="36" y="28" width="32" height="32" rx="9" />
            <rect className={styles.capAccentAmberFill} x="152" y="28" width="32" height="32" rx="9" />
            <rect className={styles.capAccentGreenFill} x="94" y="116" width="32" height="32" rx="9" />
          </g>
          <circle className={styles.capStatusDot} cx="66" cy="30" r="4.5" />
          <circle className={styles.capStatusDot} cx="182" cy="30" r="4.5" />
          <circle className={styles.capStatusDot} cx="124" cy="118" r="4.5" />
        </>
      ) : variant === 3 ? (
        // 成果交付 / 分享：成果卡（缩略+标题）+ 分享按钮。
        <>
          <circle className={styles.capBlobGreen} cx="176" cy="128" r="46" />
          <g className={styles.capElevated}>
            <rect className={styles.capCard} x="34" y="22" width="104" height="116" rx="13" />
          </g>
          <rect className={styles.capAccentAmberFill} x="46" y="34" width="80" height="44" rx="8" />
          <rect className={styles.capMuted} x="46" y="88" width="80" height="8" rx="4" />
          <rect className={styles.capMutedSoft} x="46" y="102" width="52" height="8" rx="4" />
          {/* 分享按钮（品牌实心 pill + 分享节点图标）。 */}
          <g className={styles.capElevated}>
            <rect className={styles.capShareBtn} x="128" y="60" width="66" height="30" rx="15" />
          </g>
          <circle className={styles.capOnDot} cx="142" cy="70" r="3.5" />
          <circle className={styles.capOnDot} cx="142" cy="80" r="3.5" />
          <circle className={styles.capOnDot} cx="154" cy="75" r="3.5" />
          <path className={styles.capShareLink} d="M144.5 71.5 L151.5 74 M144.5 78.5 L151.5 76" />
          <rect className={styles.capOn} x="162" y="71" width="24" height="8" rx="4" />
        </>
      ) : variant === 4 ? (
        // 团队协作：共享工作区卡 + 成员头像行。
        <>
          <circle className={styles.capBlobPink} cx="46" cy="34" r="48" />
          <g className={styles.capElevated}>
            <rect className={styles.capCard} x="24" y="46" width="172" height="94" rx="14" />
          </g>
          <rect className={styles.capMuted} x="40" y="62" width="84" height="8" rx="4" />
          <rect className={styles.capMutedSoft} x="40" y="78" width="140" height="8" rx="4" />
          <rect className={styles.capMutedSoft} x="40" y="92" width="112" height="8" rx="4" />
          <rect className={styles.capChipBrand} x="40" y="110" width="58" height="18" rx="9" />
          <rect className={styles.capOn} x="52" y="115" width="34" height="8" rx="4" />
          {/* 成员头像行（重叠 + 白描边）。 */}
          <g className={styles.capElevated}>
            <circle className={styles.capAvatarInk} cx="70" cy="34" r="18" />
            <circle className={styles.capAvatarAmber} cx="98" cy="34" r="18" />
            <circle className={styles.capAvatarPink} cx="126" cy="34" r="18" />
            <circle className={styles.capAvatarPlus} cx="154" cy="34" r="18" />
          </g>
          <path className={styles.capPlus} d="M154 27 l0 14 M147 34 l14 0" />
        </>
      ) : (
        // 多模型：模型选择下拉，一枚激活带勾。
        <>
          <circle className={styles.capBlobBlue} cx="176" cy="130" r="46" />
          <g className={styles.capElevated}>
            <rect className={styles.capCard} x="30" y="26" width="160" height="108" rx="14" />
          </g>
          {[0, 1, 2].map((i) => (
            <g key={i}>
              <rect
                className={i === 0 ? styles.capRowActive : styles.capRowIdle}
                x="42"
                y={38 + i * 30}
                width="136"
                height="22"
                rx="8"
              />
              <circle
                className={i === 0 ? styles.capIconInk : i === 1 ? styles.capIconAmber : styles.capIconBlue}
                cx="55"
                cy={49 + i * 30}
                r="6"
              />
              <rect className={styles.capMuted} x="68" y={45 + i * 30} width="70" height="7" rx="3.5" />
              {i === 0 ? <path className={styles.capCheckBrand} d="M160 49 l4 4 l7 -8" /> : null}
            </g>
          ))}
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
