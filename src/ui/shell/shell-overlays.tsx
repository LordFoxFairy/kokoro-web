"use client"

// 浮层插槽：技能/连接/作品库/价格/余额/团队六个模态的接线（纯展示，无域逻辑）。开合与团队 namespace
// 由 useOverlayPanels controller 持有，本组件只按开关渲染并注入页面级单例客户端。

import { BillingPanel } from "@/ui/billing/billing-panel"
import { PricingPanel } from "@/ui/billing/pricing-panel"
import { TeamPanel } from "@/ui/team/team-panel"
import { SkillsPanel } from "@/ui/skills/skills-panel"
import { McpPanel } from "@/ui/mcp/mcp-panel"
import { ArtifactLibraryPanel } from "@/ui/library/artifact-library-panel"
import { SettingsPanel } from "@/ui/settings/settings-panel"

import {
  browserBillingClient,
  browserHubClient,
  browserListClient,
  browserPricingClient,
  browserTeamClient,
} from "./page-clients"
import type { OverlayPanels } from "./use-overlay-panels"
import { togglePinned } from "./use-pinned-skills"

export function ShellOverlays({
  panels,
  pinnedSkills,
  onOpenSession,
  brandName,
}: {
  panels: OverlayPanels
  pinnedSkills: readonly string[]
  onOpenSession: (id: string) => void
  brandName?: string
}) {
  return (
    <>
      {panels.skillsOpen ? (
        <SkillsPanel
          client={browserHubClient()}
          onClose={panels.closeSkills}
          pinned={pinnedSkills}
          onTogglePin={togglePinned}
        />
      ) : null}

      {panels.mcpOpen ? <McpPanel client={browserHubClient()} onClose={panels.closeMcp} /> : null}

      {panels.libraryOpen ? (
        <ArtifactLibraryPanel
          client={browserListClient()}
          onClose={panels.closeLibrary}
          onOpenSession={(id) => {
            onOpenSession(id)
            panels.closeLibrary()
          }}
        />
      ) : null}

      {panels.pricingOpen ? (
        <PricingPanel client={browserPricingClient()} onClose={panels.closePricing} />
      ) : null}

      {panels.billingOpen ? (
        <BillingPanel
          client={browserBillingClient()}
          onClose={panels.closeBilling}
          onOpenPricing={() => {
            panels.closeBilling()
            panels.openPricing()
          }}
        />
      ) : null}

      {panels.teamsOpen && panels.teamNamespace !== undefined ? (
        <TeamPanel
          client={browserTeamClient()}
          currentNamespace={panels.teamNamespace}
          onClose={panels.closeTeams}
          onSwitched={() => window.location.reload()}
        />
      ) : null}

      {panels.settingsOpen ? (
        <SettingsPanel
          onClose={panels.closeSettings}
          brandName={brandName}
          onOpenPanel={(panel) => {
            // 设置浮层内的 `/?panel=X` 卡片直接切到对应浮层（关设置 + 开目标），不依赖失效的同页深链。
            panels.closeSettings()
            if (panel === "skills") panels.openSkills()
            else if (panel === "mcp") panels.openMcp()
            else if (panel === "library") panels.openLibrary()
            else if (panel === "billing") panels.openBilling()
            else if (panel === "pricing") panels.openPricing()
            else if (panel === "teams") panels.openTeams()
          }}
        />
      ) : null}
    </>
  )
}
