import { cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionToolCall } from "@/application/session-stream-reducer"
import { SegmentProcess } from "@/interfaces/session-stream/components/segment-process"

afterEach(cleanup)

// details 的展开/收起经原生 toggle 事件驱动 onToggle；先设 open 再派发 toggle 模拟用户操作。
function toggleDetails(details: HTMLDetailsElement, open: boolean): void {
  details.open = open
  fireEvent(details, new Event("toggle", { bubbles: false }))
}

const tool: SessionToolCall = {
  id: "t1",
  name: "get_weather",
  args: { city: "北京" },
  status: "done",
  result: "晴",
}

function detailOf(container: HTMLElement): HTMLDetailsElement {
  return container.querySelector("details.kk-process") as HTMLDetailsElement
}

describe("SegmentProcess collapse-on-settle", () => {
  it("opens by default while the segment is live", () => {
    const { container } = render(
      <SegmentProcess thinking="想" tools={[]} subagents={[]} live />,
    )
    expect(detailOf(container).open).toBe(true)
  })

  it("auto-collapses to its summary once the segment settles (no manual toggle)", () => {
    // 为什么重要：尾段流式时展开方便实时看；落定后必须自动收成一行摘要，
    // 而不是永远摊开——且不靠 remount（不翻 key），保留滚动与展开状态机。
    const { container, rerender } = render(
      <SegmentProcess thinking="想" tools={[tool]} subagents={[]} live />,
    )
    expect(detailOf(container).open).toBe(true)

    rerender(
      <SegmentProcess
        thinking="想"
        tools={[tool]}
        subagents={[]}
        live={false}
      />,
    )

    // 落定后自动收起（默认随 live 信号），并显示落定摘要而非「思考中…」。
    expect(detailOf(container).open).toBe(false)
    expect(detailOf(container).textContent).toMatch(/思考过程/)
  })

  it("respects a manual open and keeps it expanded after settling", () => {
    // 为什么重要：用户手动展开后，落定不得把它强行收起——尊重用户意图，不与之对抗。
    const { container, rerender } = render(
      <SegmentProcess
        thinking="想"
        tools={[tool]}
        subagents={[]}
        live={false}
      />,
    )
    // 落定态默认收起。
    expect(detailOf(container).open).toBe(false)

    // 用户手动展开（原生 details toggle）。
    toggleDetails(detailOf(container), true)
    expect(detailOf(container).open).toBe(true)

    // 同一段再次 settled 渲染：用户手动展开必须保留。
    rerender(
      <SegmentProcess
        thinking="想"
        tools={[tool]}
        subagents={[]}
        live={false}
      />,
    )
    expect(detailOf(container).open).toBe(true)
  })

  it("respects a manual collapse while still live", () => {
    // 为什么重要：流式中用户手动收起后，后续 live 渲染不得把它强行重新展开。
    const { container, rerender } = render(
      <SegmentProcess thinking="想" tools={[tool]} subagents={[]} live />,
    )
    toggleDetails(detailOf(container), false)
    expect(detailOf(container).open).toBe(false)

    rerender(
      <SegmentProcess thinking="想想更多" tools={[tool]} subagents={[]} live />,
    )
    expect(detailOf(container).open).toBe(false)
  })
})
