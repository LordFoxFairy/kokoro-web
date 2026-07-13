// Composer 模型选择器（MODEL-UX）：候选下拉渲染 + 选择回调（wire "provider:name"）+ 首条锁定态 + 空候选隐藏。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ModelCandidate } from "@/contract/http"
import { LocaleProvider } from "@/i18n/context"
import { Composer } from "@/ui/composer/composer"

const MODELS: ModelCandidate[] = [
  { provider: "anthropic", name: "claude-sonnet-4-6", is_default: true },
  { provider: "openai", name: "gpt-5", is_default: false },
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
