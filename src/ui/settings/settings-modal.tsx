"use client"

// 设置中心(WEB-FACE 面三):浮在工作区之上的模态卡片面板——左 tab 竖导航 + 右内容区,一次显一个 tab。
// 打开不再导航离开(语境原地保留),关闭走 Modal 背幕/Esc/右上 ×。所有管理功能(账户/外观/对话/订阅/
// 技能/连接/作品/团队)统一此处 tab 切换,不再跳独立弹窗或整页。tab 内部自持(initialTab 决定初值,
// onTabChange 上抛给 shell 同步 URL `?settings=`),shell 重开切 tab 时 initialTab 变化即重置。
// 会话态由 shell 保证(SessionShell 仅在信封有效时渲染),本组件不再自持匿名闸。
// 分区内容:账户/外观/对话复用 settings-sections;订阅/技能/连接/作品/团队复用 XxxContent。

import { useEffect, useState, type ComponentType } from "react"

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
import { Modal } from "@/ui/common/modal"
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
import styles from "./settings-modal.module.css"

export type SettingsTab =
  | "account"
  | "appearance"
  | "chat"
  | "subscription"
  | "skills"
  | "mcp"
  | "library"
  | "team"

export const SETTINGS_TABS: readonly SettingsTab[] = [
  "account",
  "appearance",
  "chat",
  "subscription",
  "skills",
  "mcp",
  "library",
  "team",
]

// 外部值(URL `?settings=`)归一到已知 tab,否则默认账户;非法/缺失回退。
export function normalizeSettingsTab(value: string | null | undefined): SettingsTab {
  return SETTINGS_TABS.find((key) => key === value) ?? "account"
}

type SettingsModalProps = {
  // 服务端按 host 解析的站点品牌名(SITE-REAL);缺省回退 Kokoro。
  brandName?: string
  // 打开时的初始 tab(shell 从入口/URL 传入);变化即重置内部 tab(支持重开切 tab)。
  initialTab: SettingsTab
  onClose: () => void
  // 内部切 tab 时上抛,供 shell 同步 URL `?settings=`(刷新/深链/可分享)。
  onTabChange?: (tab: SettingsTab) => void
}

export function SettingsModal({ brandName, initialTab, onClose, onTabChange }: SettingsModalProps) {
  const t = useT()
  // 内部自持选中 tab,初值取 initialTab。shell 主动开到不同 tab 时以 key 重挂载本组件重置初值
  // (故此处无需 effect 同步 initialTab);内部切 tab 不改 shell 态、不重挂,选中态自然保持。
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  // 团队切换器高亮当前 namespace:undefined=未取,null=预览/无信封,string=当前 team id。
  const [teamNs, setTeamNs] = useState<string | null | undefined>(undefined)
  const pinnedSkills = usePinnedSkills(browserEngine())

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

  const selectTab = (next: SettingsTab): void => {
    setTab(next)
    if (next === "team") {
      setTeamNs(undefined) // 每次进团队重取 ns(切换后回来反映新态)。
    }
    onTabChange?.(next)
  }

  const nav: { key: SettingsTab; label: string; Icon: ComponentType<{ className?: string }> }[] = [
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
    <Modal ariaLabel={t("settings.title")} onClose={onClose} testId="settings-modal" size="wide">
      <div className={styles.layout}>
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
        </nav>

        <div className={styles.content}>
          <div className={styles.contentHead}>
            <h1 className={styles.contentTitle}>{activeLabel}</h1>
            <button
              type="button"
              className={styles.close}
              aria-label={t("settings.close")}
              data-testid="settings-close"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          {/* key=tab:切分区重挂载 → 入场动画重放。 */}
          <div key={tab} className={styles.contentBody}>
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
                  // 作品跳源会话:共享引擎单例 openConversation 设 activeId,关模态即回工作台该会话
                  // (模态本就浮在 "/" 之上,无需再导航)。
                  browserEngine()?.openConversation(id)
                  onClose()
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
        </div>
      </div>
    </Modal>
  )
}
