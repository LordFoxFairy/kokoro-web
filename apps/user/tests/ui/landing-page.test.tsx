// 营销落地页组件测试（WEB-FACE 面一）：品牌注入、能力区/FAQ 齐全、hero 输入暂存草稿并跳 /login。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocaleProvider } from "@/i18n/context"
import { LandingPage } from "@/ui/marketing/landing-page"

const push = vi.fn()
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}))

function renderLanding(brandName?: string) {
  // 固定中文源：jsdom 的 navigator.languages 会协商到 en，显式落 zh 以断言源文案。
  window.localStorage.setItem("kokoro.locale", "zh")
  return render(<LandingPage brandName={brandName} />, { wrapper: LocaleProvider })
}

afterEach(() => {
  cleanup()
  push.mockClear()
  window.localStorage.clear()
})

describe("LandingPage", () => {
  it("renders the injected brand name in top bar and footer", () => {
    renderLanding("Acme")
    expect(screen.getAllByText("Acme").length).toBeGreaterThanOrEqual(2)
  })

  it("falls back to Kokoro when no brand is provided", () => {
    renderLanding()
    expect(screen.getAllByText("Kokoro").length).toBeGreaterThanOrEqual(1)
  })

  it("renders all six capability sections and four FAQ items", () => {
    renderLanding()
    expect(screen.getByText("对话即协作，关键处由你把关")).toBeInTheDocument()
    expect(screen.getByText("技能库，按需装配能力")).toBeInTheDocument()
    expect(screen.getByText("连接你的工具与数据")).toBeInTheDocument()
    expect(screen.getByText("成果可交付、可分享")).toBeInTheDocument()
    expect(screen.getByText("与团队共享一个工作区")).toBeInTheDocument()
    expect(screen.getByText("多模型，随任务切换")).toBeInTheDocument()
    expect(screen.getByText("怎么计费？")).toBeInTheDocument()
    expect(screen.getByText("我的数据归谁？")).toBeInTheDocument()
    expect(screen.getByText("支持团队协作吗？")).toBeInTheDocument()
    expect(screen.getByText("能接入我自己的工具吗？")).toBeInTheDocument()
  })

  it("stashes the hero draft and routes to /login on submit", () => {
    renderLanding()
    fireEvent.change(screen.getByTestId("landing-hero-input"), {
      target: { value: "帮我起草季度复盘" },
    })
    fireEvent.click(screen.getByTestId("landing-hero-start"))
    expect(push).toHaveBeenCalledWith("/login")
    const drafts = JSON.parse(window.localStorage.getItem("kokoro.web.drafts") ?? "{}")
    expect(drafts.__pending__).toBe("帮我起草季度复盘")
  })

  it("routes to /login even with an empty hero draft without stashing", () => {
    renderLanding()
    fireEvent.click(screen.getByTestId("landing-hero-start"))
    expect(push).toHaveBeenCalledWith("/login")
    expect(window.localStorage.getItem("kokoro.web.drafts")).toBeNull()
  })
})
