"use client"

// 设置分区内容（账户 / 外观与语言 / 对话偏好 / 订阅与余额 / 能力入口）：从 settings-page 抽出，
// 供设置中心（/settings）各 tab 复用，单一真源。每卡就地保存或即时生效。
// 诚实态：信封只有 user_id/namespace/site_id，无客户端 email，不造假 email 行；无密码/API key 机制。

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import type { AgentCandidate, BillingSummary, ModelCandidate } from "@/contract/http"
import { formatMicros } from "@/billing/format"
import { useLocale, useT } from "@/i18n/context"
import { useTheme, type ThemeMode } from "@/ui/theme/theme-context"
import type { Locale } from "@/i18n/messages"
import { browserBillingClient, browserListClient, browserTeamClient } from "@/ui/shell/page-clients"

import { readChatAgent, readChatModel, writeChatAgent, writeChatModel } from "./chat-prefs"
import styles from "./settings-page.module.css"

// 缺省选择占位：跟随空间缺省（不上 wire）。以哨兵值区分于具体候选。
const FOLLOW_PROFILE = ""

function modelSelector(model: ModelCandidate): string {
  return `${model.provider}:${model.name}`
}

// —— 卡一：账户 —— 当前团队（namespace→listMyTeams 解析名）+ 切换入口 + 登出。
export function AccountCard() {
  const t = useT()
  const router = useRouter()
  // undefined=未取，null=预览/无信封，string=已解析团队名。
  const [teamName, setTeamName] = useState<string | null | undefined>(undefined)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const namespace = await browserTeamClient().currentNamespace()
        if (namespace === null) {
          if (live) setTeamName(null)
          return
        }
        const teams = await browserTeamClient().listMyTeams()
        const match = teams.find((entry) => entry.team.id === namespace)
        if (live) setTeamName(match?.team.name ?? null)
      } catch {
        if (live) setTeamName(null)
      }
    })()
    return () => {
      live = false
    }
  }, [])

  const logout = async (): Promise<void> => {
    setLoggingOut(true)
    try {
      await fetch("/api/auth/logout", { method: "POST" })
    } catch {
      // 登出失败也回首页：信封若仍在，首页闸会重新裁决。
    }
    router.push("/")
  }

  const teamLabel =
    teamName === undefined
      ? t("settings.loading")
      : teamName === null
        ? t("settings.accountTeamPreview")
        : teamName
  // 身份概览头像取团队名首字母；未取到/无名回退占位字母（不硬凑 email，信封无此字段）。
  const initial = ((teamName ?? "").trim().charAt(0) || "K").toUpperCase()

  return (
    <section className={styles.card} data-settings-card data-testid="settings-account">
      <div className={styles.identity}>
        <span className={styles.identityAvatar} aria-hidden>
          {initial}
        </span>
        <div className={styles.identityText}>
          <p className={styles.identityName}>{teamLabel}</p>
          <p className={styles.identityMeta}>{t("settings.accountSpaceLabel")}</p>
        </div>
      </div>
      <div className={styles.cardActions}>
        <Link className={styles.secondaryBtn} href="/?panel=teams">
          {t("settings.accountSwitchTeam")}
        </Link>
        <button
          type="button"
          className={styles.dangerBtn}
          disabled={loggingOut}
          onClick={() => void logout()}
          data-testid="settings-logout"
        >
          {t("settings.logout")}
        </button>
      </div>
    </section>
  )
}

// —— 卡二：外观与语言 —— 主题三档（WEB-THEME）/ 语言 zh·en（i18n）即时生效。
export function AppearanceCard() {
  const t = useT()
  const { mode, setMode } = useTheme()
  const { locale, setLocale } = useLocale()

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: "system", label: t("theme.system") },
    { value: "light", label: t("theme.light") },
    { value: "dark", label: t("theme.dark") },
  ]
  const langOptions: { value: Locale; label: string }[] = [
    { value: "zh", label: t("lang.zh") },
    { value: "en", label: t("lang.en") },
  ]

  return (
    <section className={styles.card} data-settings-card data-testid="settings-appearance">
      <div className={styles.row}>
        <span className={styles.rowLabel}>{t("settings.theme")}</span>
        <div className={styles.segment} role="group" aria-label={t("theme.switchAria")}>
          {themeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.segmentBtn}
              data-active={mode === option.value}
              aria-pressed={mode === option.value}
              onClick={() => setMode(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.row}>
        <span className={styles.rowLabel}>{t("settings.language")}</span>
        <div className={styles.segment} role="group" aria-label={t("lang.switchAria")}>
          {langOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={styles.segmentBtn}
              data-active={locale === option.value}
              aria-pressed={locale === option.value}
              onClick={() => setLocale(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

// —— 卡三：对话偏好 —— 缺省模型（/models）/缺省 agent（/agents）；就地存 localStorage，
// 工作台新对话首帧预填（会话级锁语义不变）。
export function ChatPrefsCard() {
  const t = useT()
  const [models, setModels] = useState<readonly ModelCandidate[]>([])
  const [agents, setAgents] = useState<readonly AgentCandidate[]>([])
  const [model, setModel] = useState<string>(() => readChatModel() ?? FOLLOW_PROFILE)
  const [agent, setAgent] = useState<string>(() => readChatAgent() ?? FOLLOW_PROFILE)
  // 就地保存反馈：改动后闪一枚「已保存」徽标，约 1.6s 后自动消（setState 在 timeout 内，非 effect 体内直接调）。
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let live = true
    void browserListClient()
      .listModels()
      .then((list) => live && setModels(list.models))
      .catch(() => live && setModels([]))
    void browserListClient()
      .listAgents()
      .then((list) => live && setAgents(list.agents))
      .catch(() => live && setAgents([]))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!saved) {
      return
    }
    const id = setTimeout(() => setSaved(false), 1600)
    return () => clearTimeout(id)
  }, [saved])

  const onModelChange = (value: string): void => {
    setModel(value)
    writeChatModel(value === FOLLOW_PROFILE ? null : value)
    setSaved(true)
  }
  const onAgentChange = (value: string): void => {
    setAgent(value)
    writeChatAgent(value === FOLLOW_PROFILE ? null : value)
    setSaved(true)
  }

  return (
    <section className={styles.card} data-settings-card data-testid="settings-chat">
      {saved ? (
        <div className={styles.cardHead}>
          <span className={styles.savedBadge} role="status" data-testid="settings-saved">
            {t("settings.saved")}
          </span>
        </div>
      ) : null}
      <label className={styles.row}>
        <span className={styles.rowLabel}>{t("settings.defaultModel")}</span>
        <select
          className={styles.select}
          value={model}
          onChange={(event) => onModelChange(event.target.value)}
          data-testid="settings-default-model"
        >
          <option value={FOLLOW_PROFILE}>{t("settings.followProfile")}</option>
          {models.map((candidate) => (
            <option key={modelSelector(candidate)} value={modelSelector(candidate)}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.row}>
        <span className={styles.rowLabel}>{t("settings.defaultAgent")}</span>
        <select
          className={styles.select}
          value={agent}
          onChange={(event) => onAgentChange(event.target.value)}
          data-testid="settings-default-agent"
        >
          <option value={FOLLOW_PROFILE}>{t("settings.followProfile")}</option>
          {agents.map((candidate) => (
            <option key={candidate.name} value={candidate.name}>
              {candidate.name}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.cardHint}>{t("settings.chatHint")}</p>
    </section>
  )
}

// —— 卡四：订阅与余额 —— 余额摘要（billing summary 复用）+ 查看流水/价格页入口。
export function SubscriptionCard() {
  const t = useT()
  const [summary, setSummary] = useState<BillingSummary | null | "error">(null)

  useEffect(() => {
    let live = true
    void browserBillingClient()
      .summary()
      .then((data) => live && setSummary(data))
      .catch(() => live && setSummary("error"))
    return () => {
      live = false
    }
  }, [])

  return (
    <section className={styles.card} data-settings-card data-testid="settings-subscription">
      <h2 className={styles.cardTitle}>{t("settings.subTitle")}</h2>
      <div className={styles.row}>
        <span className={styles.rowLabel}>{t("billing.balance")}</span>
        <span className={styles.rowValue} data-testid="settings-balance">
          {summary === null
            ? t("settings.loading")
            : summary === "error"
              ? t("billing.loadError")
              : formatMicros(summary.balance_micros)}
        </span>
      </div>
      {summary !== null && summary !== "error" ? (
        <div className={styles.row}>
          <span className={styles.rowLabel}>{t("billing.held")}</span>
          <span className={styles.rowValue}>{formatMicros(summary.held_micros)}</span>
        </div>
      ) : null}
      <div className={styles.cardActions}>
        <Link className={styles.secondaryBtn} href="/?panel=billing">
          {t("settings.subViewLedger")}
        </Link>
        <Link className={styles.secondaryBtn} href="/?panel=pricing">
          {t("billing.viewPricing")}
        </Link>
      </div>
    </section>
  )
}

// —— 卡五：能力入口 —— 技能库/连接(MCP)/作品库三个跳转卡（rail 面板同源，不重复实现）。
export function CapabilitiesCard() {
  const t = useT()
  const entries: { href: string; title: string; hint: string; testId: string }[] = [
    { href: "/?panel=skills", title: t("settings.capSkills"), hint: t("settings.capSkillsHint"), testId: "settings-cap-skills" },
    { href: "/?panel=mcp", title: t("settings.capMcp"), hint: t("settings.capMcpHint"), testId: "settings-cap-mcp" },
    { href: "/?panel=library", title: t("settings.capLibrary"), hint: t("settings.capLibraryHint"), testId: "settings-cap-library" },
  ]
  return (
    <section className={styles.card} data-settings-card data-testid="settings-capabilities">
      <h2 className={styles.cardTitle}>{t("settings.capsTitle")}</h2>
      <div className={styles.capGrid}>
        {entries.map((entry) => (
          <Link key={entry.href} className={styles.capCard} href={entry.href} data-testid={entry.testId}>
            <span className={styles.capCardTitle}>{entry.title}</span>
            <span className={styles.capCardHint}>{entry.hint}</span>
            <span className={styles.capCardOpen} aria-hidden>
              {t("settings.capOpen")} →
            </span>
          </Link>
        ))}
      </div>
    </section>
  )
}
