import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ChatPage } from "../chat-page"

describe("ChatPage", () => {
  it("renders greeting empty state + composer + sidebar", () => {
    render(<ChatPage />)
    expect(screen.getByText("Kokoro")).toBeInTheDocument()
    expect(screen.getByText(/今天想做/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText("把想说的告诉我。")).toBeInTheDocument()
  })
})
