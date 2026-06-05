import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type {
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream-reducer"
import { ProcessBlock } from "@/interfaces/session-stream/components/process-block"

afterEach(cleanup)

const empty = {
  thinking: "",
  toolCalls: [] as SessionToolCall[],
  subagents: [] as SessionSubagent[],
  live: false,
}

const tool: SessionToolCall = {
  id: "t1",
  name: "get_weather",
  args: { city: "北京" },
  result: "晴, 24°C",
  status: "done",
}

const subagent: SessionSubagent = {
  id: "s1",
  name: "weather-analyst",
  description: "分析天气与出行适宜度",
  status: "running",
}

describe("ProcessBlock", () => {
  it("renders nothing when there is no thinking/tool/subagent activity", () => {
    // 为什么重要：无过程时不能在助手分组里插入空的披露块。
    const { container } = render(<ProcessBlock {...empty} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("does not render the todo plan (that belongs above the input, not in the turn)", () => {
    // 为什么重要：布局分工——计划归 TodoBar，过程块只负责思考/工具/子智能体。
    render(<ProcessBlock {...empty} thinking="想一想" />)
    expect(screen.queryByRole("list", { name: "计划" })).toBeNull()
  })

  it("is live and expanded while the turn streams: shows thinking, tools, subagents", () => {
    // 为什么重要：流式时这块应展开方便实时看，标题显示「思考中…」并带脉冲。
    render(
      <ProcessBlock
        thinking={"先取天气。\n再判断。"}
        toolCalls={[tool]}
        subagents={[subagent]}
        live
      />,
    )
    expect(screen.getByText("思考中…")).toBeInTheDocument()
    expect(screen.getByLabelText("思考中")).toBeInTheDocument()
    expect(screen.getByText(/先取天气/)).toBeInTheDocument()
    expect(screen.getByText("get_weather")).toBeInTheDocument()
    expect(screen.getByText("weather-analyst")).toBeInTheDocument()
  })

  it("collapses to a one-line summary with a tool count once the turn settles", () => {
    // 为什么重要：落定后收成一行「思考过程 · N 个工具」摘要，保持对话干净；不再显示脉冲。
    render(<ProcessBlock thinking="x" toolCalls={[tool]} subagents={[]} live={false} />)
    expect(screen.getByText("思考过程 · 1 个工具")).toBeInTheDocument()
    expect(screen.queryByLabelText("思考中")).not.toBeInTheDocument()
  })

  it("exposes a tool's args/result and a subagent's description", () => {
    // 为什么重要：工具要可观测（入参/返回），子智能体要露出职责——这才是有用的「过程」。
    render(
      <ProcessBlock thinking="" toolCalls={[tool]} subagents={[subagent]} live />,
    )
    expect(screen.getByText(/"city": "北京"/)).toBeInTheDocument()
    expect(screen.getByText("晴, 24°C")).toBeInTheDocument()
    expect(screen.getByText("分析天气与出行适宜度")).toBeInTheDocument()
  })
})
