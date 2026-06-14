import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionToolCall } from "@/application/session-stream/reducer"
import { ToolCallRow } from "@/interfaces/session-stream/components/thread/tool-call-row"

afterEach(cleanup)

function makeTool(overrides: Partial<SessionToolCall> = {}): SessionToolCall {
  return {
    id: "t1",
    name: "get_weather",
    args: {},
    status: "running",
    ...overrides,
  }
}

describe("ToolCallRow", () => {
  it("carries a running state class while the tool is in flight", () => {
    const { container } = render(
      <ToolCallRow tool={makeTool({ status: "running" })} />,
    )
    expect(container.querySelector(".kk-tool")).toHaveClass("kk-tool--running")
    expect(container.querySelector(".kk-tool")).not.toHaveClass("kk-tool--done")
  })

  it("carries a done state class once the tool has returned", () => {
    const { container } = render(
      <ToolCallRow
        tool={makeTool({ status: "done", result: "晴, 24°C" })}
      />,
    )
    expect(container.querySelector(".kk-tool")).toHaveClass("kk-tool--done")
    expect(container.querySelector(".kk-tool")).not.toHaveClass(
      "kk-tool--running",
    )
  })

  it("is an interactive disclosure (details) when there is a result", () => {
    const { container } = render(
      <ToolCallRow
        tool={makeTool({ status: "done", result: "晴, 24°C" })}
      />,
    )
    expect(container.querySelector("details.kk-tool")).toBeInTheDocument()
    expect(screen.getByText("晴, 24°C")).toBeInTheDocument()
  })

  it("is an interactive disclosure when there are args", () => {
    const { container } = render(
      <ToolCallRow tool={makeTool({ args: { city: "北京" } })} />,
    )
    expect(container.querySelector("details.kk-tool")).toBeInTheDocument()
    expect(screen.getByText(/"city": "北京"/)).toBeInTheDocument()
  })

  it("is NOT an interactive disclosure when there is no detail (no dead toggle)", () => {
    // 为什么重要：无入参/无结果时不能有可点的空 <details>，那是无效的死切换。
    const { container } = render(
      <ToolCallRow tool={makeTool({ args: {}, result: undefined })} />,
    )
    expect(container.querySelector("details")).toBeNull()
    expect(container.querySelector(".kk-tool")).toBeInTheDocument()
    expect(screen.getByText("get_weather")).toBeInTheDocument()
  })

  it("D1: shows a chevron affordance only on expandable rows (so 可点 vs 静态 is legible)", () => {
    // 为什么重要：可展开行与静态行视觉几乎一样，用户看不出哪个可点；chevron 作为统一的「可展开」提示。
    const expandable = render(
      <ToolCallRow tool={makeTool({ status: "done", result: "晴" })} />,
    )
    const chevron = expandable.container.querySelector(".kk-tool__chevron")
    expect(chevron).not.toBeNull()
    // chevron 必须落在 <summary> 内（点击区域），否则提示与触发区脱节。
    expect(chevron?.closest("summary.kk-tool__summary")).not.toBeNull()
    expandable.unmount()

    const staticRow = render(
      <ToolCallRow tool={makeTool({ args: {}, result: undefined, status: "done" })} />,
    )
    expect(staticRow.container.querySelector(".kk-tool__chevron")).toBeNull()
  })

  it("surfaces an error state with its errorText, staying expanded", () => {
    // 为什么重要：工具失败是段级状态（本轮通常继续）——必须显式露出失败原因并保持展开，
    // 绝不塌成沉默的空行。即便无入参也作为可展开的 <details> 呈现错误面板。
    const { container } = render(
      <ToolCallRow
        tool={makeTool({ status: "error", errorText: "timeout after 30s" })}
      />,
    )
    const details = container.querySelector("details.kk-tool")
    expect(details).toBeInTheDocument()
    expect(container.querySelector(".kk-tool")).toHaveClass("kk-tool--error")
    expect((details as HTMLDetailsElement).open).toBe(true)
    expect(screen.getByText("timeout after 30s")).toBeInTheDocument()
  })

  it("falls back to a default error message when errorText is empty (no blank red bar)", () => {
    // 无消息异常 → errorText 空串：错误面板回落到兜底文案，绝不渲染空白红条。
    const { container } = render(
      <ToolCallRow tool={makeTool({ status: "error", errorText: "" })} />,
    )
    const error = container.querySelector(".kk-tool__error") as HTMLElement
    expect(error).not.toBeNull()
    expect(error.textContent).toBe("工具调用失败")
  })

  it("fires approve once and disables both buttons after deciding (HITL)", () => {
    const decisions: string[] = []
    render(
      <ToolCallRow
        tool={makeTool({ status: "awaiting", args: { url: "http://x" } })}
        onApprove={() => decisions.push("approve")}
        onReject={() => decisions.push("reject")}
      />,
    )
    const approve = screen.getByText("批准")
    fireEvent.click(approve)
    // 点击后两按钮立即禁用：连点不再发第二条决定（否则被下一个待批工具误读）。
    fireEvent.click(approve)
    fireEvent.click(screen.getByText("拒绝"))
    expect(decisions).toEqual(["approve"])
    expect(approve).toBeDisabled()
  })

  it("fires reject when rejected (HITL)", () => {
    const decisions: string[] = []
    render(
      <ToolCallRow
        tool={makeTool({ status: "awaiting", args: { url: "http://x" } })}
        onApprove={() => decisions.push("approve")}
        onReject={() => decisions.push("reject")}
      />,
    )
    fireEvent.click(screen.getByText("拒绝"))
    expect(decisions).toEqual(["reject"])
  })

  it("carries the awaiting state class", () => {
    const { container } = render(
      <ToolCallRow tool={makeTool({ status: "awaiting" })} />,
    )
    expect(container.querySelector(".kk-tool")).toHaveClass("kk-tool--awaiting")
  })
})
