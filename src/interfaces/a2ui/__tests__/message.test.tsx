import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { A2uiSurface } from "@a2ui/react/v0_9"
import { MessageProcessor } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "../catalog"

function surfaceFor(messages: unknown[]) {
  const processor = new MessageProcessor([kokoroChatCatalog])
  processor.processMessages(messages as never)
  return processor.model.getSurface("s")!
}

describe("Message (kokoro/chat/v1)", () => {
  it("renders an assistant message from dataModel binding, left-aligned, no bubble", () => {
    const surface = surfaceFor([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } },
      { version: "v0.9", updateComponents: { surfaceId: "s", components: [
        { id: "root", component: "Thread", children: ["m1"] },
        { id: "m1", component: "Message", author: "ai", text: { path: "/messages/m1" } },
      ] } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/messages/m1", value: "你好，我在。" } },
    ])
    render(<A2uiSurface surface={surface} />)
    const el = screen.getByText("你好，我在。")
    expect(el.closest(".kk-msg")).toHaveClass("kk-msg--ai")
  })
})
