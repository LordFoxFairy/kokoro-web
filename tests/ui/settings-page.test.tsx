// 用户设置页测试（WEB-FACE 面三）：匿名闸重定向、五卡渲染、对话偏好就地存 localStorage、
// 能力入口深链、余额摘要。会话态 hook 与 page-clients 均注入 mock（不打网络）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LocaleProvider } from "@/i18n/context"
import { ThemeProvider } from "@/ui/theme/theme-context"

const replace = vi.fn()
const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
}))

let sessionState: "checking" | "pass" | "anonymous" = "pass"
vi.mock("@/ui/auth/use-session-state", () => ({
  useSessionState: () => sessionState,
}))

vi.mock("@/ui/shell/page-clients", () => ({
  browserTeamClient: () => ({
    currentNamespace: vi.fn().mockResolvedValue("team_1"),
    listMyTeams: vi.fn().mockResolvedValue([
      { team: { id: "team_1", name: "Studio", type: "team" }, membership: { role: "owner" } },
    ]),
  }),
  browserBillingClient: () => ({
    summary: vi.fn().mockResolvedValue({ balance_micros: "12500000", held_micros: "500000" }),
  }),
  browserListClient: () => ({
    listModels: vi.fn().mockResolvedValue({
      models: [{ provider: "anthropic", name: "opus", is_default: true }],
    }),
    listAgents: vi.fn().mockResolvedValue({
      agents: [{ name: "general", description: "default", is_default: true }],
    }),
  }),
}))

// import 顺延到 mock 之后。
import { SettingsPage } from "@/ui/settings/settings-page"

function renderSettings() {
  window.localStorage.setItem("kokoro.locale", "zh")
  return render(
    <ThemeProvider>
      <LocaleProvider>
        <SettingsPage brandName="Acme" />
      </LocaleProvider>
    </ThemeProvider>,
  )
}

beforeEach(() => {
  sessionState = "pass"
  replace.mockClear()
  push.mockClear()
})

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe("SettingsPage", () => {
  it("redirects anonymous visitors to /login", () => {
    sessionState = "anonymous"
    renderSettings()
    expect(replace).toHaveBeenCalledWith("/login")
  })

  it("renders all five settings cards when authenticated", async () => {
    renderSettings()
    expect(screen.getByTestId("settings-account")).toBeInTheDocument()
    expect(screen.getByTestId("settings-appearance")).toBeInTheDocument()
    expect(screen.getByTestId("settings-chat")).toBeInTheDocument()
    expect(screen.getByTestId("settings-subscription")).toBeInTheDocument()
    expect(screen.getByTestId("settings-capabilities")).toBeInTheDocument()
    // 当前团队名从 namespace 解析。
    expect(await screen.findByText("Studio")).toBeInTheDocument()
  })

  it("persists a chosen default model to localStorage", async () => {
    renderSettings()
    const select = await screen.findByTestId("settings-default-model")
    fireEvent.change(select, { target: { value: "anthropic:opus" } })
    const prefs = JSON.parse(window.localStorage.getItem("kokoro.web.chat-prefs") ?? "{}")
    expect(prefs.model).toBe("anthropic:opus")
  })

  it("links capability entries to the workspace panel deep links", () => {
    renderSettings()
    expect(screen.getByTestId("settings-cap-skills")).toHaveAttribute("href", "/?panel=skills")
    expect(screen.getByTestId("settings-cap-mcp")).toHaveAttribute("href", "/?panel=mcp")
    expect(screen.getByTestId("settings-cap-library")).toHaveAttribute("href", "/?panel=library")
  })

  it("shows the billing balance summary", async () => {
    renderSettings()
    const balance = await screen.findByTestId("settings-balance")
    expect(balance.textContent).toContain("12.5")
  })
})
