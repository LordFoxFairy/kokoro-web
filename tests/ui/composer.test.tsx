// Composer 模型选择器（MODEL-UX）：候选下拉渲染 + 选择回调（wire "provider:name"）+ 首条锁定态 + 空候选隐藏。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AgentCandidate, ModelCandidate } from "@/contract/http"
import { LocaleProvider } from "@/i18n/context"
import { Composer } from "@/ui/composer/composer"

const MODELS: ModelCandidate[] = [
  { provider: "anthropic", name: "claude-sonnet-4-6", is_default: true },
  { provider: "openai", name: "gpt-5", is_default: false },
]

const AGENTS: AgentCandidate[] = [
  { name: "general", description: "通用协调 agent", is_default: true },
  { name: "poet", description: "诗人预设", is_default: false },
]

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
  const props = {
    draft: "",
    onDraftChange: vi.fn(),
    onKeyDown: vi.fn(),
    onSubmit: vi.fn((e: { preventDefault: () => void }) => e.preventDefault()),
    isStreaming: false,
    canSend: false,
    onStop: vi.fn(),
    transportLabel: "ready",
    modeHint: "hint",
    composerRef: { current: null },
    mode: "fast" as const,
    onModeChange: vi.fn(),
    modeLocked: false,
    pinnedSkills: [],
    onUnpinSkill: vi.fn(),
    models: MODELS,
    selectedModel: null,
    onModelChange: vi.fn(),
    modelLocked: false,
    agents: [] as AgentCandidate[],
    selectedAgent: null,
    onAgentChange: vi.fn(),
    agentLocked: false,
    ...overrides,
  }
  render(<Composer {...props} />, { wrapper: LocaleProvider })
  return props
}

afterEach(cleanup)

describe("Composer model selector", () => {
  it("selectedModel=null 时高亮缺省候选（is_default）", () => {
    renderComposer()
    expect(screen.getByText("claude-sonnet-4-6")).toBeTruthy()
  })

  it("展开下拉选非缺省项 → onModelChange 收到 provider:name 选择子", () => {
    const props = renderComposer()
    fireEvent.click(screen.getByRole("button", { name: "Switch model" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "gpt-5" }))
    expect(props.onModelChange).toHaveBeenCalledWith("openai:gpt-5")
  })

  it("selectedModel 命中候选时显示该项为当前", () => {
    renderComposer({ selectedModel: "openai:gpt-5" })
    // 触发器展示当前选择的名称。
    expect(screen.getByRole("button", { name: "Switch model" }).textContent).toContain("gpt-5")
  })

  it("modelLocked → 只读锁定态（不可展开切换）", () => {
    renderComposer({ selectedModel: "openai:gpt-5", modelLocked: true })
    expect(screen.queryByRole("button", { name: "Switch model" })).toBeNull()
    const locked = screen.getByRole("button", { name: /locked this turn/i })
    expect(locked.hasAttribute("disabled")).toBe(true)
    expect(locked.textContent).toContain("gpt-5")
  })

  it("空候选 → 不渲染模型选择器", () => {
    renderComposer({ models: [] })
    expect(screen.queryByRole("button", { name: "Switch model" })).toBeNull()
  })
})

describe("Composer agent selector（AGENT-PRESET）", () => {
  it("selectedAgent=null 时高亮缺省候选（is_default=general）", () => {
    renderComposer({ agents: AGENTS })
    expect(screen.getByRole("button", { name: "Switch agent" }).textContent).toContain("general")
  })

  it("展开下拉选具名预设 → onAgentChange 收到 agent 名", () => {
    const props = renderComposer({ agents: AGENTS })
    fireEvent.click(screen.getByRole("button", { name: "Switch agent" }))
    fireEvent.click(screen.getByRole("menuitemradio", { name: "poet" }))
    expect(props.onAgentChange).toHaveBeenCalledWith("poet")
  })

  it("selectedAgent 命中候选时显示该项为当前", () => {
    renderComposer({ agents: AGENTS, selectedAgent: "poet" })
    expect(screen.getByRole("button", { name: "Switch agent" }).textContent).toContain("poet")
  })

  it("agentLocked → 只读锁定态（不可展开切换）", () => {
    renderComposer({ agents: AGENTS, selectedAgent: "poet", agentLocked: true })
    expect(screen.queryByRole("button", { name: "Switch agent" })).toBeNull()
    const locked = screen.getByRole("button", { name: /locked this turn/i })
    expect(locked.hasAttribute("disabled")).toBe(true)
    expect(locked.textContent).toContain("poet")
  })

  it("单候选（仅 general）→ 不渲染 agent 选择器（无可选项，隐去）", () => {
    renderComposer({ agents: [AGENTS[0]!] })
    expect(screen.queryByRole("button", { name: "Switch agent" })).toBeNull()
  })

  it("空候选 → 不渲染 agent 选择器", () => {
    renderComposer({ agents: [] })
    expect(screen.queryByRole("button", { name: "Switch agent" })).toBeNull()
  })
})
