import { cleanup, render, screen } from "@testing-library/react"
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
})
