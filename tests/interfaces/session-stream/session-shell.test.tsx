import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import { SessionShell } from "@/interfaces/session-stream/session-shell"

afterEach(() => {
  cleanup()
})

describe("SessionShell", () => {
  it("renders the approved minimal first-screen shell", () => {
    render(<SessionShell />)

    expect(screen.getByText("Kokoro")).toBeInTheDocument()
    expect(screen.getByText("新对话")).toBeInTheDocument()
    expect(screen.getByText("搜索")).toBeInTheDocument()
    expect(screen.getByText("当前用户")).toBeInTheDocument()

    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
    expect(screen.getByText("不急，先把想法说给我")).toBeInTheDocument()

    expect(screen.getByText("把想说的告诉我。"))
      .toBeInTheDocument()
    expect(screen.getAllByText("Fast").length).toBeGreaterThan(0)

    expect(screen.queryByText("A2UI artifact preview")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Protocol-first chat shell for AGUI + SSE replay."),
    ).not.toBeInTheDocument()
  })

  it("keeps the calmer composer controls visible by default", () => {
    render(<SessionShell />)

    expect(screen.getByLabelText("附加内容")).toBeInTheDocument()
    expect(screen.getByLabelText("切换模式")).toBeInTheDocument()
    expect(screen.getByLabelText("语音输入")).toBeInTheDocument()
    expect(screen.getByLabelText("发送消息")).toBeInTheDocument()
  })
})
