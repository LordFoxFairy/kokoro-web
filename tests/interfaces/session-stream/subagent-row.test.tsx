import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionSubagent } from "@/application/session-stream-reducer"
import { SubagentRow } from "@/interfaces/session-stream/components/subagent-row"

afterEach(cleanup)

describe("SubagentRow", () => {
  it("shows built-in source and subagent type", () => {
    const subagent: SessionSubagent = {
      id: "s1",
      name: "researcher",
      description: "查资料",
      subagentType: "researcher",
      source: "built-in",
      status: "running",
    }

    render(<SubagentRow subagent={subagent} />)

    expect(screen.getByText("researcher")).toBeInTheDocument()
    expect(screen.getByText("内置 · researcher")).toBeInTheDocument()
    expect(screen.getByText("查资料")).toBeInTheDocument()
  })

  it("shows config-defined custom source and subagent type", () => {
    const subagent: SessionSubagent = {
      id: "s2",
      name: "reviewer",
      description: "审稿",
      subagentType: "reviewer",
      source: "config-custom",
      status: "done",
    }

    render(<SubagentRow subagent={subagent} />)

    expect(screen.getByText("reviewer")).toBeInTheDocument()
    expect(screen.getByText("配置自定义 · reviewer")).toBeInTheDocument()
    expect(screen.getByText("审稿")).toBeInTheDocument()
  })

  it("shows runtime custom source and subagent type", () => {
    const subagent: SessionSubagent = {
      id: "s3",
      name: "runtime-reviewer",
      description: "运行时审稿",
      subagentType: "runtime-reviewer",
      source: "runtime-custom",
      status: "done",
    }

    render(<SubagentRow subagent={subagent} />)

    expect(screen.getByText("runtime-reviewer")).toBeInTheDocument()
    expect(screen.getByText("运行时自定义 · runtime-reviewer")).toBeInTheDocument()
    expect(screen.getByText("运行时审稿")).toBeInTheDocument()
  })

  it("shows nested output when subagent internal text is available", () => {
    const subagent: SessionSubagent = {
      id: "s4",
      name: "researcher",
      description: "查资料",
      subagentType: "researcher",
      source: "built-in",
      output: "子智能体结论",
      status: "done",
    }

    render(<SubagentRow subagent={subagent} />)

    expect(screen.getByText("子智能体结论")).toBeInTheDocument()
  })
})
