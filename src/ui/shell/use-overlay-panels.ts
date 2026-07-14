"use client"

// 浮层面板开合 controller：技能/连接/余额/价格/团队/作品库六个模态的开关；团队面板打开时取当前
// namespace（切换器高亮当前项，每次打开重取，切换后回来反映新态）。undefined=未取，null=无信封/预览。
// 深链（WEB-FACE 面三）：settings 的入口卡以 `/?panel=<name>` 跳回工作台并直接打开对应面板——
// 初值由 URL 参数懒派生（不在 effect 内直接 setState），打开后 strip 掉参数（刷新/后退不重开）。

import { useCallback, useEffect, useState } from "react"

import { browserTeamClient } from "./page-clients"

export type PanelName = "skills" | "mcp" | "billing" | "pricing" | "teams" | "library" | "settings"

// 从当前 URL 读 `?panel=` 深链目标（仅浏览器）：命中六个已知面板名之一才返回。
function panelFromUrl(): PanelName | null {
  if (typeof window === "undefined") {
    return null
  }
  const value = new URLSearchParams(window.location.search).get("panel")
  const known: readonly PanelName[] = ["skills", "mcp", "billing", "pricing", "teams", "library", "settings"]
  return known.find((name) => name === value) ?? null
}

export type OverlayPanels = {
  skillsOpen: boolean
  mcpOpen: boolean
  billingOpen: boolean
  pricingOpen: boolean
  teamsOpen: boolean
  libraryOpen: boolean
  settingsOpen: boolean
  teamNamespace: string | null | undefined
  openSkills: () => void
  closeSkills: () => void
  openMcp: () => void
  closeMcp: () => void
  openBilling: () => void
  closeBilling: () => void
  openPricing: () => void
  closePricing: () => void
  openTeams: () => void
  closeTeams: () => void
  openLibrary: () => void
  closeLibrary: () => void
  openSettings: () => void
  closeSettings: () => void
}

export function useOverlayPanels(): OverlayPanels {
  // 首帧从 URL 深链懒派生初值（键控派生优先于 effect setState）。
  const initial = panelFromUrl()
  const [skillsOpen, setSkillsOpen] = useState(initial === "skills")
  const [mcpOpen, setMcpOpen] = useState(initial === "mcp")
  const [billingOpen, setBillingOpen] = useState(initial === "billing")
  const [pricingOpen, setPricingOpen] = useState(initial === "pricing")
  const [teamsOpen, setTeamsOpen] = useState(initial === "teams")
  const [libraryOpen, setLibraryOpen] = useState(initial === "library")
  const [settingsOpen, setSettingsOpen] = useState(initial === "settings")
  // 当前团队 namespace（切换器高亮）：undefined=未取，null=无信封/预览，string=当前 team id。
  const [teamNamespace, setTeamNamespace] = useState<string | null | undefined>(undefined)

  // 深链打开后即 strip 掉 `?panel=`：刷新/后退不再重复弹面板（history 替换，不改渲染态）。
  useEffect(() => {
    if (initial !== null && typeof window !== "undefined") {
      const url = new URL(window.location.href)
      url.searchParams.delete("panel")
      window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash)
    }
    // 仅挂载时处理一次深链。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 团队面板打开且 namespace 未取时拉当前 namespace（按钮开与深链开共用同一路径；切换后回来重取）。
  // setState 在异步 then 内，非 effect 体内直接调用。
  useEffect(() => {
    if (!teamsOpen || teamNamespace !== undefined) {
      return
    }
    let live = true
    void browserTeamClient()
      .currentNamespace()
      .then((ns) => live && setTeamNamespace(ns))
      .catch(() => live && setTeamNamespace(null))
    return () => {
      live = false
    }
  }, [teamsOpen, teamNamespace])

  // 每次打开团队面板都重取 namespace：置回 undefined 触发上面的 effect。
  const openTeams = useCallback(() => {
    setTeamNamespace(undefined)
    setTeamsOpen(true)
  }, [])

  return {
    skillsOpen,
    mcpOpen,
    billingOpen,
    pricingOpen,
    teamsOpen,
    libraryOpen,
    settingsOpen,
    teamNamespace,
    openSkills: useCallback(() => setSkillsOpen(true), []),
    closeSkills: useCallback(() => setSkillsOpen(false), []),
    openMcp: useCallback(() => setMcpOpen(true), []),
    closeMcp: useCallback(() => setMcpOpen(false), []),
    openBilling: useCallback(() => setBillingOpen(true), []),
    closeBilling: useCallback(() => setBillingOpen(false), []),
    openPricing: useCallback(() => setPricingOpen(true), []),
    closePricing: useCallback(() => setPricingOpen(false), []),
    openTeams,
    closeTeams: useCallback(() => setTeamsOpen(false), []),
    openLibrary: useCallback(() => setLibraryOpen(true), []),
    closeLibrary: useCallback(() => setLibraryOpen(false), []),
    openSettings: useCallback(() => setSettingsOpen(true), []),
    closeSettings: useCallback(() => setSettingsOpen(false), []),
  }
}
