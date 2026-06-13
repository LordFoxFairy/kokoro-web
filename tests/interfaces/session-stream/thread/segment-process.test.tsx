import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionToolCall } from "@/application/session-stream/reducer"
import { __resetDisclosureCacheForTest } from "@/application/session-stream/process-disclosure"
import { SegmentProcess } from "@/interfaces/session-stream/components/thread/segment-process"

// 展开意图持久化在 disclosure store（module 级 + localStorage）：每个用例后清空，隔离。
afterEach(() => {
  cleanup()
  window.localStorage.clear()
  __resetDisclosureCacheForTest()
})

const SEG = "run_1:seg_0001"

const tool: SessionToolCall = {
  id: "t1",
  name: "get_weather",
  args: { city: "北京" },
  status: "done",
  result: "晴",
}

// 过程块现为受控 div+button（非原生 details，以便高度过渡）：
// 展开态钉在 .kk-process[data-open]，用户操作 = 点击 summary 按钮。
function processOf(container: HTMLElement): HTMLElement {
  return container.querySelector(".kk-process") as HTMLElement
}

function isOpen(container: HTMLElement): boolean {
  return processOf(container).getAttribute("data-open") === "true"
}

function clickSummary(container: HTMLElement): void {
  fireEvent.click(container.querySelector(".kk-process__summary") as HTMLElement)
}

describe("SegmentProcess collapse-on-settle", () => {
  it("opens by default while the segment is live", () => {
    const { container } = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[]} subagents={[]} live />,
    )
    expect(isOpen(container)).toBe(true)
  })

  it("auto-collapses to its summary once the segment settles (no manual toggle)", () => {
    // 为什么重要：尾段流式时展开方便实时看；落定后必须自动收成一行摘要，
    // 而不是永远摊开——且不靠 remount（不翻 key），保留展开状态机。
    const { container, rerender } = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[tool]} subagents={[]} live />,
    )
    expect(isOpen(container)).toBe(true)

    rerender(
      <SegmentProcess
        segmentId={SEG}
        thinking="想"
        tools={[tool]}
        subagents={[]}
        live={false}
      />,
    )

    // 落定后自动收起（默认随 live 信号），并显示落定摘要而非「思考中…」。
    expect(isOpen(container)).toBe(false)
    expect(processOf(container).textContent).toMatch(/思考过程/)
  })

  it("respects a manual open and keeps it expanded after settling", () => {
    // 为什么重要：用户手动展开后，落定不得把它强行收起——尊重用户意图，不与之对抗。
    const { container, rerender } = render(
      <SegmentProcess
        segmentId={SEG}
        thinking="想"
        tools={[tool]}
        subagents={[]}
        live={false}
      />,
    )
    // 落定态默认收起。
    expect(isOpen(container)).toBe(false)

    // 用户手动展开（点击 summary）。
    clickSummary(container)
    expect(isOpen(container)).toBe(true)

    // 同一段再次 settled 渲染：用户手动展开必须保留。
    rerender(
      <SegmentProcess
        segmentId={SEG}
        thinking="想"
        tools={[tool]}
        subagents={[]}
        live={false}
      />,
    )
    expect(isOpen(container)).toBe(true)
  })

  it("respects a manual collapse while still live", () => {
    // 为什么重要：流式中用户手动收起后，后续 live 渲染不得把它强行重新展开。
    const { container, rerender } = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[tool]} subagents={[]} live />,
    )
    clickSummary(container)
    expect(isOpen(container)).toBe(false)

    rerender(
      <SegmentProcess segmentId={SEG} thinking="想想更多" tools={[tool]} subagents={[]} live />,
    )
    expect(isOpen(container)).toBe(false)
  })

  it("removes collapsed process content from the a11y tree (inert when closed)", () => {
    // 为什么重要：原生 details 收起时把内容移出无障碍树；换成 div 后必须用 inert 补回该语义，
    // 否则 aria-expanded=false 但读屏仍朗读折叠的思考/工具，自相矛盾。inert 不设 display:none，
    // 故高度过渡仍可动（靠 clip 的 overflow:hidden 视觉裁剪）。
    const { container, rerender } = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[tool]} subagents={[]} live />,
    )
    const body = () => container.querySelector(".kk-process__body") as HTMLElement
    // 展开（live）态：内容在无障碍树里、可聚焦。
    expect(body().hasAttribute("inert")).toBe(false)

    rerender(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[tool]} subagents={[]} live={false} />,
    )
    // 落定收起：内容移出无障碍树 + 不可聚焦。
    expect(body().hasAttribute("inert")).toBe(true)
  })

  it("keeps the reveal>clip>body layering so collapse clips the body scroll viewport to 0", () => {
    // 为什么重要：收起态（grid 0fr）靠 __clip(overflow:hidden) 把 __body 自带的滚动视口整体裁到 0；
    // 少了 clip 层就会残留一截空盒（曾真实发生）。结构断言守住这条三层不变量防回归。
    const { container } = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[tool]} subagents={[]} live />,
    )
    const reveal = container.querySelector(".kk-process__reveal")
    const clip = reveal?.querySelector(":scope > .kk-process__clip")
    const body = clip?.querySelector(":scope > .kk-process__body")
    expect(reveal).not.toBeNull()
    expect(clip).not.toBeNull()
    expect(body).not.toBeNull()
  })

  it("C: a manual expand persists to localStorage and reloads from it (not just module-singleton)", () => {
    // Scope C 核心：手动展开意图落 localStorage（按 segmentId）。卸载后清掉 module 缓存（模拟「全新页面」，
    // 内存单例不复存在），重新挂载仍展开——证明恢复来自落盘 localStorage，而非仅 module 单例存活。
    const first = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[tool]} subagents={[]} live={false} />,
    )
    expect(isOpen(first.container)).toBe(false)
    clickSummary(first.container)
    expect(isOpen(first.container)).toBe(true)
    first.unmount()

    // 清 module 缓存（保留 localStorage）= 真刷新语义：内存态没了，只剩盘面。
    __resetDisclosureCacheForTest()
    const second = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[tool]} subagents={[]} live={false} />,
    )
    expect(isOpen(second.container)).toBe(true)
  })

  it("C: distinct segmentIds keep independent disclosure overrides", () => {
    const a = render(
      <SegmentProcess segmentId="run_1:seg_0001" thinking="想" tools={[tool]} subagents={[]} live={false} />,
    )
    clickSummary(a.container)
    expect(isOpen(a.container)).toBe(true)
    const b = render(
      <SegmentProcess segmentId="run_1:seg_0002" thinking="想" tools={[tool]} subagents={[]} live={false} />,
    )
    expect(isOpen(b.container)).toBe(false)
  })

  it("D2 (revived): a failed tool shows as a sub-modifier of 工具, not an additive dimension", () => {
    // 真实 tool-error 接通后 status=error 可达：摘要把失败数括注在「工具」里（子集语义，不被读成相加）。
    const tools: SessionToolCall[] = [
      { id: "a", name: "x", args: {}, status: "done", result: "ok" },
      { id: "b", name: "y", args: {}, status: "error", errorText: "boom" },
    ]
    const { container } = render(
      <SegmentProcess segmentId={SEG} thinking="" tools={tools} subagents={[]} live={false} />,
    )
    const title = (container.querySelector(".kk-process__title") as HTMLElement).textContent
    expect(title).toMatch(/2 个工具（1 失败）/)
  })

  it("D2: no failure note when nothing failed", () => {
    const tools: SessionToolCall[] = [
      { id: "a", name: "x", args: {}, status: "done", result: "ok" },
    ]
    const { container } = render(
      <SegmentProcess segmentId={SEG} thinking="" tools={tools} subagents={[]} live={false} />,
    )
    expect(
      (container.querySelector(".kk-process__title") as HTMLElement).textContent,
    ).not.toMatch(/失败/)
  })

  it("exposes button a11y: aria-expanded tracks open, aria-controls points at the body", () => {
    // 为什么重要：换掉原生 details 后，展开语义必须由 button 的 aria 显式承担，键盘可达。
    const { container } = render(
      <SegmentProcess segmentId={SEG} thinking="想" tools={[]} subagents={[]} live />,
    )
    const button = container.querySelector(".kk-process__summary") as HTMLButtonElement
    expect(button.tagName).toBe("BUTTON")
    expect(button.getAttribute("aria-expanded")).toBe("true")
    const bodyId = button.getAttribute("aria-controls")
    expect(bodyId).toBeTruthy()
    expect(container.querySelector(`#${CSS.escape(bodyId as string)}`)).not.toBeNull()
  })
})
