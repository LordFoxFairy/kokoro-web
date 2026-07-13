"use client"

// 浮层面板开合 controller：技能/连接/余额/价格/团队/作品库六个模态的开关；团队面板打开时取当前
// namespace（切换器高亮当前项，每次打开重取，切换后回来反映新态）。undefined=未取，null=无信封/预览。

import { useCallback, useState } from "react"

import { browserTeamClient } from "./page-clients"

export type OverlayPanels = {
  skillsOpen: boolean
  mcpOpen: boolean
  billingOpen: boolean
  pricingOpen: boolean
  teamsOpen: boolean
  libraryOpen: boolean
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
}

export function useOverlayPanels(): OverlayPanels {
  const [skillsOpen, setSkillsOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [billingOpen, setBillingOpen] = useState(false)
  const [pricingOpen, setPricingOpen] = useState(false)
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(false)
  // 当前团队 namespace（切换器高亮）：undefined=未取，null=无信封/预览，string=当前 team id。
  const [teamNamespace, setTeamNamespace] = useState<string | null | undefined>(undefined)

  const openTeams = useCallback(() => {
    setTeamNamespace(undefined)
    setTeamsOpen(true)
    void browserTeamClient()
      .currentNamespace()
      .then((ns) => setTeamNamespace(ns))
      .catch(() => setTeamNamespace(null))
  }, [])

  return {
    skillsOpen,
    mcpOpen,
    billingOpen,
    pricingOpen,
    teamsOpen,
    libraryOpen,
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
  }
}
