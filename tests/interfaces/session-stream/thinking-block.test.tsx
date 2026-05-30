import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ThinkingBlock } from "@/interfaces/session-stream/thinking-block"

describe("ThinkingBlock", () => {
  it("is collapsed by default and hides the summary", () => {
    render(<ThinkingBlock summary="weighing the search options" />)

    expect(screen.getByText("思考")).toBeInTheDocument()
    expect(
      screen.queryByText("weighing the search options"),
    ).not.toBeInTheDocument()
  })

  it("reveals the summary when expanded", () => {
    render(<ThinkingBlock summary="weighing the search options" />)

    fireEvent.click(screen.getByRole("button"))

    expect(
      screen.getByText("weighing the search options"),
    ).toBeInTheDocument()
  })
})
