import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ToolCard } from "@/interfaces/session-stream/tool-card"

describe("ToolCard", () => {
  it("shows a running indicator while the tool is in flight", () => {
    render(
      <ToolCard
        toolName="echo_search"
        toolCallId="call_01"
        status="running"
      />,
    )

    expect(screen.getByText("echo_search")).toBeInTheDocument()
    expect(screen.getByText("运行中")).toBeInTheDocument()
    expect(screen.queryByText("完成")).not.toBeInTheDocument()
  })

  it("shows a done indicator once the tool completes", () => {
    render(
      <ToolCard toolName="echo_search" toolCallId="call_01" status="done" />,
    )

    expect(screen.getByText("完成")).toBeInTheDocument()
    expect(screen.queryByText("运行中")).not.toBeInTheDocument()
  })
})
