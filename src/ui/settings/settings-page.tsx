"use client"

// 设置中心(WEB-FACE 面三,/settings):全屏左 tab 竖导航 + 右内容区,所有管理功能(账户/外观/对话/订阅/
// 技能/连接/作品/团队)统一此处 tab 切换,不再跳任何独立弹窗。tab 由 URL `?tab=X` 驱动——刷新/深链保持,
// rail 各管理入口都跳对应 tab。分区内容:账户/外观/对话复用 settings-sections;订阅/技能/连接/作品/团队
// 复用从原弹窗剥离的 XxxContent。与管理后台严格分离;匿名 → 重定向 /login。

import { useEffect, useState, type ComponentType } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"

import { useT } from "@/i18n/context"
import {
  ChatsIcon,
  CoinIcon,
  LibraryIcon,
  PlugIcon,
  SlidersIcon,
  SunIcon,
  UserIcon,
  UsersIcon,
} from "@/ui/icons/rail"
import { useSessionState } from "@/ui/auth/use-session-state"
import {
  browserBillingClient,
  browserEngine,
  browserHubClient,
  browserListClient,
  browserPricingClient,
  browserTeamClient,
} from "@/ui/shell/page-clients"
import { togglePinned, usePinnedSkills } from "@/ui/shell/use-pinned-skills"
import { SkillsContent } from "@/ui/skills/skills-panel"
import { McpContent } from "@/ui/mcp/mcp-panel"
import { BillingContent } from "@/ui/billing/billing-panel"
import { PricingContent } from "@/ui/billing/pricing-panel"
import { LibraryContent } from "@/ui/library/artifact-library-panel"
import { TeamContent } from "@/ui/team/team-panel"

import { AccountCard, AppearanceCard, ChatPrefsCard } from "./settings-sections"
import styles from "./settings-center.module.css"

type TabKey =
  | "account"
  | "appearance"
  | "chat"
  | "subscription"
  | "skills"
  | "mcp"
  | "library"
  | "team"

const TAB_KEYS: readonly TabKey[] = [
  "account",
  "appearance",
  "chat",
  "subscription",
  "skills",
  "mcp",
  "library",
  "team",
]

// URL `?tab=` 归一到已知 tab,否则默认账户。
function tabFromParam(value: string | null): TabKey {
  return TAB_KEYS.find((key) => key === value) ?? "account"
}

export function SettingsPage({ brandName }: { brandName?: string }) {
  const t = useT()
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionState = useSessionState()
  // 初值从 URL query 派生(useSearchParams 在 SSR/client 一致,跨页导航到 ?tab=X 首帧即命中目标 tab)。
  const [tab, setTab] = useState<TabKey>(() => tabFromParam(searchParams.get("tab")))
  // 团队切换器高亮当前 namespace:undefined=未取,null=预览/无信封,string=当前 team id。
  const [teamNs, setTeamNs] = useState<string | null | undefined>(undefined)
  const pinnedSkills = usePinnedSkills(browserEngine())

  // 匿名闸:探针裁定匿名即回登录页(settings 是登录后面)。
  useEffect(() => {
    if (sessionState === "anonymous") {
      router.replace("/login")
    }
  }, [sessionState, router])

  // 进入团队 tab 且 ns 未取时拉当前 namespace(切 tab 走 selectTab 会置回 undefined 触发重取)。
  useEffect(() => {
    if (tab !== "team" || teamNs !== undefined) {
      return
    }
    let live = true
    void browserTeamClient()
      .currentNamespace()
      .then((ns) => live && setTeamNs(ns))
      .catch(() => live && setTeamNs(null))
    return () => {
      live = false
    }
  }, [tab, teamNs])

  const selectTab = (next: TabKey): void => {
    setTab(next)
    if (next === "team") {
      setTeamNs(undefined) // 每次进团队重取 ns(切换后回来反映新态)。
    }
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.set("tab", next)
      window.history.replaceState(window.history.state, "", url.pathname + url.search)
    }
  }

  if (sessionState !== "pass") {
    return null
  }

  const nav: { key: TabKey; label: string; Icon: ComponentType<{ className?: string }> }[] = [
    { key: "account", label: t("settings.accountTitle"), Icon: UserIcon },
    { key: "appearance", label: t("settings.appearanceTitle"), Icon: SunIcon },
    { key: "chat", label: t("settings.chatTitle"), Icon: ChatsIcon },
    { key: "subscription", label: t("settings.subTitle"), Icon: CoinIcon },
    { key: "skills", label: t("rail.navSkills"), Icon: SlidersIcon },
    { key: "mcp", label: t("rail.navMcp"), Icon: PlugIcon },
    { key: "library", label: t("rail.navLibrary"), Icon: LibraryIcon },
    { key: "team", label: t("rail.navTeams"), Icon: UsersIcon },
  ]
  const activeLabel = nav.find((entry) => entry.key === tab)?.label ?? ""

  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label={t("settings.title")}>
        <div className={styles.brand}>
          <p className={styles.brandTitle}>{t("settings.title")}</p>
          <p className={styles.brandName}>{brandName ?? "Kokoro"}</p>
        </div>
        <div className={styles.tabList} role="tablist" aria-orientation="vertical">
          {nav.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              role="tab"
              className={styles.tab}
              data-active={tab === key}
              data-testid={`settings-tab-${key}`}
              aria-selected={tab === key}
              onClick={() => selectTab(key)}
            >
              <span className={styles.tabIcon} aria-hidden>
                <Icon className={styles.tabIconSvg} />
              </span>
              {label}
            </button>
          ))}
        </div>
        <Link className={styles.backLink} href="/">
          ← {t("settings.backToApp")}
        </Link>
      </nav>

      <main className={styles.content}>
        {/* key=tab:切分区重挂载 → 入场动画重放。 */}
        <div key={tab} className={styles.contentInner}>
          <h1 className={styles.contentTitle}>{activeLabel}</h1>
          {tab === "account" ? <AccountCard /> : null}
          {tab === "appearance" ? <AppearanceCard /> : null}
          {tab === "chat" ? <ChatPrefsCard /> : null}
          {tab === "subscription" ? (
            <>
              <BillingContent client={browserBillingClient()} />
              <PricingContent client={browserPricingClient()} />
            </>
          ) : null}
          {tab === "skills" ? (
            <SkillsContent
              client={browserHubClient()}
              pinned={pinnedSkills}
              onTogglePin={togglePinned}
            />
          ) : null}
          {tab === "mcp" ? <McpContent client={browserHubClient()} /> : null}
          {tab === "library" ? (
            <LibraryContent
              client={browserListClient()}
              onOpenSession={(id) => {
                // 作品跳源会话:共享引擎单例 openConversation 设 activeId,回工作台即渲染该会话。
                browserEngine()?.openConversation(id)
                router.push("/")
              }}
            />
          ) : null}
          {tab === "team" ? (
            <TeamContent
              client={browserTeamClient()}
              currentNamespace={teamNs ?? null}
              onSwitched={() => window.location.reload()}
            />
          ) : null}
        </div>
      </main>
    </div>
  )
}
