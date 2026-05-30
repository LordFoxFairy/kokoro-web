import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { A2uiSurface } from "@a2ui/react/v0_9"
import { MessageProcessor, type A2uiMessage } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "../catalog"

describe("Thread (kokoro/chat/v1)", () => {
  it("renders children in order", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    processor.processMessages([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } },
      { version: "v0.9", updateComponents: { surfaceId: "s", components: [
        { id: "root", component: "Thread", children: ["m1", "m2"] },
        { id: "m1", component: "Message", author: "ai", text: { path: "/m1" } },
        { id: "m2", component: "Message", author: "ai", text: { path: "/m2" } },
      ] } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/m1", value: "一" } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/m2", value: "二" } },
    ] as A2uiMessage[])
    render(<A2uiSurface surface={processor.model.getSurface("s")!} />)
    const container = screen.getByTestId("kk-thread")
    expect(container.textContent).toBe("一二")
  })
})
