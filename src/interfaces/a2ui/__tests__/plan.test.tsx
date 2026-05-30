import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { A2uiSurface } from "@a2ui/react/v0_9"
import { MessageProcessor, type A2uiMessage } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "../catalog"

describe("Plan (kokoro/chat/v1)", () => {
  it("renders a todo checklist with statuses", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    processor.processMessages([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } },
      { version: "v0.9", updateComponents: { surfaceId: "s", components: [
        { id: "root", component: "Thread", children: ["p1"] },
        { id: "p1", component: "Plan", todosPath: { path: "/plans/p1" } },
      ] } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/plans/p1", value: [
        { content: "draft outline", status: "completed" },
        { content: "write copy", status: "in_progress" },
        { content: "review", status: "pending" },
      ] } },
    ] as A2uiMessage[])
    render(<A2uiSurface surface={processor.model.getSurface("s")!} />)
    expect(screen.getByText("draft outline")).toBeInTheDocument()
    expect(screen.getByText("write copy")).toBeInTheDocument()
    const items = screen.getAllByTestId("kk-todo")
    expect(items).toHaveLength(3)
    expect(items[0].dataset.status).toBe("completed")
    expect(items[1].dataset.status).toBe("in_progress")
  })
})
