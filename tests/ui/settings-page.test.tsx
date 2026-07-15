// 设置中心测试（WEB-FACE 面三）：匿名闸重定向、默认账户 tab、8 tab 导航、tab 切换单显、对话偏好
// 就地存 localStorage。会话态 hook 与 page-clients 均注入 mock（不打网络）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LocaleProvider } from "@/i18n/context"
import { ThemeProvider } from "@/ui/theme/theme-context"

const replace = vi.fn()
const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(),
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
  // account/appearance/chat tab 不调用下列客户端；仅需存在 export 供模块 import。
  browserHubClient: () => ({}),
  browserPricingClient: () => ({}),
  browserEngine: () => null,
}))

// import 顺延到 mock 之后。
import { SettingsPage } from "@/ui/settings/settings-page"

const TAB_KEYS = ["account", "appearance", "chat", "subscription", "skills", "mcp", "library", "team"]

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

describe("SettingsPage 设置中心", () => {
  it("匿名访客重定向 /login", () => {
    sessionState = "anonymous"
    renderSettings()
    expect(replace).toHaveBeenCalledWith("/login")
  })

  it("默认渲染账户 tab + 8 个 tab 导航 + 解析团队名", async () => {
    renderSettings()
    expect(screen.getByTestId("settings-account")).toBeInTheDocument()
    for (const key of TAB_KEYS) {
      expect(screen.getByTestId(`settings-tab-${key}`)).toBeInTheDocument()
    }
    // 账户身份头团队名从 namespace 解析。
    expect(await screen.findByText("Studio")).toBeInTheDocument()
  })

  it("切到外观 tab:显示外观分区、账户分区移出 DOM（一次只显一个 tab）", () => {
    renderSettings()
    fireEvent.click(screen.getByTestId("settings-tab-appearance"))
    expect(screen.getByTestId("settings-appearance")).toBeInTheDocument()
    expect(screen.queryByTestId("settings-account")).not.toBeInTheDocument()
  })

  it("对话 tab:选缺省模型就地存 localStorage + 就地保存反馈", async () => {
    renderSettings()
    fireEvent.click(screen.getByTestId("settings-tab-chat"))
    const select = await screen.findByTestId("settings-default-model")
    fireEvent.change(select, { target: { value: "anthropic:opus" } })
    const prefs = JSON.parse(window.localStorage.getItem("kokoro.web.chat-prefs") ?? "{}")
    expect(prefs.model).toBe("anthropic:opus")
    expect(screen.getByTestId("settings-saved")).toBeInTheDocument()
  })
})
