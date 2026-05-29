import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SessionShell } from "@/interfaces/session-stream/session-shell"

describe("SessionShell", () => {
  it("renders the folded assistant message and status", () => {
    render(<SessionShell />)

    expect(
      screen.getByText("Kokoro / session stream preview"),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Hello from replay-safe shell."),
    ).toBeInTheDocument()
    expect(screen.getByText("completed")).toBeInTheDocument()
    expect(screen.getByText("A2UI artifact preview")).toBeInTheDocument()
  })
})
