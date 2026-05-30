import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { A2uiSurface } from "@a2ui/react/v0_9"
import { MessageProcessor, type A2uiMessage } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "../catalog"

function surfaceFor(status: string) {
  const processor = new MessageProcessor([kokoroChatCatalog])
  processor.processMessages([
    { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } },
    { version: "v0.9", updateComponents: { surfaceId: "s", components: [
      { id: "root", component: "Thread", children: ["c1"] },
      { id: "c1", component: "ToolCard", toolName: "echo_search", status },
    ] } },
  ] as A2uiMessage[])
  return processor.model.getSurface("s")!
}

describe("ToolCard (kokoro/chat/v1)", () => {
  it("shows running state", () => {
    render(<A2uiSurface surface={surfaceFor("running")} />)
    expect(screen.getByText(/echo_search/)).toBeInTheDocument()
    expect(screen.getByTestId("kk-tool").dataset.status).toBe("running")
  })
  it("shows done state", () => {
    render(<A2uiSurface surface={surfaceFor("ok")} />)
    expect(screen.getByTestId("kk-tool").dataset.status).toBe("ok")
  })
})
