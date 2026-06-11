import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionSubagent } from "@/application/session-stream/reducer"
import { SubagentRow } from "@/interfaces/session-stream/components/subagent-row"

afterEach(cleanup)

function makeSubagent(
  overrides: Partial<SessionSubagent> = {},
): SessionSubagent {
  return {
    id: "s1",
    name: "researcher",
    description: "查资料",
    subagentType: "researcher",
    source: "built-in",
    status: "running",
    ...overrides,
  }
}

describe("SubagentRow", () => {
  it("shows built-in source with a distinct source chip and type label", () => {
    const { container } = render(
      <SubagentRow subagent={makeSubagent({ source: "built-in" })} />,
    )

    expect(screen.getByText("researcher")).toBeInTheDocument()
    expect(screen.getByText("内置 · researcher")).toBeInTheDocument()
    // 来源标识用 data-source 钩子让 CSS 区分胶囊样式。
    expect(container.querySelector(".kk-subagent")).toHaveAttribute(
      "data-source",
      "built-in",
    )
  })

  it("shows config-defined custom source with its own chip and type label", () => {
    const { container } = render(
      <SubagentRow
        subagent={makeSubagent({
          id: "s2",
          name: "reviewer",
          description: "审稿",
          subagentType: "reviewer",
          source: "config-custom",
          status: "done",
        })}
      />,
    )

    expect(screen.getByText("reviewer")).toBeInTheDocument()
    expect(screen.getByText("配置自定义 · reviewer")).toBeInTheDocument()
    expect(container.querySelector(".kk-subagent")).toHaveAttribute(
      "data-source",
      "config-custom",
    )
  })

  it("shows runtime custom source with its own chip and type label", () => {
    const { container } = render(
      <SubagentRow
        subagent={makeSubagent({
          id: "s3",
          name: "runtime-reviewer",
          description: "运行时审稿",
          subagentType: "runtime-reviewer",
          source: "runtime-custom",
          status: "done",
        })}
      />,
    )

    expect(screen.getByText("runtime-reviewer")).toBeInTheDocument()
    expect(screen.getByText("运行时自定义 · runtime-reviewer")).toBeInTheDocument()
    expect(container.querySelector(".kk-subagent")).toHaveAttribute(
      "data-source",
      "runtime-custom",
    )
  })

  it("each source renders a visually distinct chip via data-source", () => {
    // 为什么重要：三种来源不能只靠灰字区分，胶囊样式钩子必须各不相同。
    const sources: SessionSubagent["source"][] = [
      "built-in",
      "config-custom",
      "runtime-custom",
    ]
    const rendered = sources.map((source, index) => {
      const { container } = render(
        <SubagentRow subagent={makeSubagent({ id: `src-${index}`, source })} />,
      )
      return container
        .querySelector(".kk-subagent")
        ?.getAttribute("data-source")
    })
    expect(new Set(rendered).size).toBe(3)
  })

  it("renders a multi-sentence output FULLY (not clipped) when expanded", () => {
    // 为什么重要：子智能体结论可能是多句段落，必须整段换行展示，
    // 而不是被 ellipsis 截成一行灰字。
    const output =
      "第一句结论。第二句进一步解释为什么。第三句给出后续建议与下一步动作。"
    render(
      <SubagentRow
        subagent={makeSubagent({
          id: "s4",
          output,
          status: "done",
        })}
      />,
    )

    // 展开后整段文本可被完整读到（react-markdown 渲染为段落）。
    expect(screen.getByText(output)).toBeInTheDocument()
  })

  it("is an interactive disclosure (details) when there is output", () => {
    // 为什么重要：有结论才提供展开口，结构对齐 ToolCallRow 的 <details>。
    const { container } = render(
      <SubagentRow
        subagent={makeSubagent({ id: "s5", output: "结论", status: "done" })}
      />,
    )
    expect(container.querySelector("details.kk-subagent")).toBeInTheDocument()
  })

  it("stays open by default while the subagent is still running", () => {
    const { container } = render(
      <SubagentRow
        subagent={makeSubagent({
          id: "s6",
          output: "进行中的中间产物",
          status: "running",
        })}
      />,
    )
    const details = container.querySelector("details.kk-subagent")
    expect(details).toBeInTheDocument()
    expect((details as HTMLDetailsElement).open).toBe(true)
  })

  it("keeps the short description visible in the row head", () => {
    // 为什么重要：职责是常驻可见的元信息，应随行头一直显示，
    // 不藏进展开口里——展开口只为完整结论而存在。
    render(
      <SubagentRow
        subagent={makeSubagent({
          id: "s7b",
          description: "分析天气与出行适宜度",
          output: undefined,
          status: "running",
        })}
      />,
    )
    expect(screen.getByText("分析天气与出行适宜度")).toBeInTheDocument()
  })

  it("is NOT an interactive disclosure when there is no output (simple row)", () => {
    // 为什么重要：没有结论时不渲染空的死 <details>，避免无意义的切换。
    const { container } = render(
      <SubagentRow
        subagent={makeSubagent({
          id: "s7",
          description: "",
          output: undefined,
          status: "done",
        })}
      />,
    )
    expect(container.querySelector("details")).toBeNull()
    expect(container.querySelector(".kk-subagent")).toBeInTheDocument()
  })
})
