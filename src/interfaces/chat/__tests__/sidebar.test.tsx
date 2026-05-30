import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { Sidebar } from "../sidebar"

describe("Sidebar", () => {
  it("renders brand + primary nav + creation group", () => {
    render(<Sidebar />)
    expect(screen.getByText("Kokoro")).toBeInTheDocument()
    expect(screen.getByText("新对话")).toBeInTheDocument()
    for (const label of ["图片", "视频", "数字人", "音频", "设计", "文档", "站点"]) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })
})
