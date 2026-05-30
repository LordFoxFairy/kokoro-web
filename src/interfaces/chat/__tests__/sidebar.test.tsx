import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Sidebar } from "../sidebar"

describe("Sidebar", () => {
  it("renders brand + primary nav + creation group", () => {
    render(<Sidebar />)
    expect(screen.getByText("Kokoro")).toBeInTheDocument()
    expect(screen.getByText("新对话")).toBeInTheDocument()
    expect(screen.getByText("搜索")).toBeInTheDocument()
    for (const label of ["图片", "视频", "数字人", "音频", "设计", "文档", "站点"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it("renders discover group + user row", () => {
    render(<Sidebar />)
    for (const label of ["案例", "Skill Hub", "MCP Hub"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText("小 · 免费")).toBeInTheDocument()
  })
})
