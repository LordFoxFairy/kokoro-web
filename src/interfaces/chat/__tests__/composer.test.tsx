import { render, screen, fireEvent } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { Composer } from "../composer"

describe("Composer", () => {
  it("submits trimmed input and clears", () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    const field = screen.getByPlaceholderText("把想说的告诉我。") as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: "  你好  " } })
    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    expect(onSend).toHaveBeenCalledWith("你好")
    expect(field.value).toBe("")
  })

  it("does not submit empty", () => {
    const onSend = vi.fn()
    render(<Composer onSend={onSend} />)
    fireEvent.click(screen.getByRole("button", { name: "发送" }))
    expect(onSend).not.toHaveBeenCalled()
  })
})
