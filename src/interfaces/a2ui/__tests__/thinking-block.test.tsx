import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { A2uiSurface } from "@a2ui/react/v0_9"
import { MessageProcessor } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "../catalog"

describe("ThinkingBlock (kokoro/chat/v1)", () => {
  it("renders collapsed summary text from dataModel", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    processor.processMessages([
      { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } },
      { version: "v0.9", updateComponents: { surfaceId: "s", components: [
        { id: "root", component: "Thread", children: ["t1"] },
        { id: "t1", component: "ThinkingBlock", summary: { path: "/t1" } },
      ] } },
      { version: "v0.9", updateDataModel: { surfaceId: "s", path: "/t1", value: "在想要不要先查一下。" } },
    ] as never)
    render(<A2uiSurface surface={processor.model.getSurface("s")!} />)
    expect(screen.getByText("在想要不要先查一下。")).toBeInTheDocument()
    // 默认折叠：details 无 open 属性
    const details = screen.getByText("在想要不要先查一下。").closest("details")
    expect(details).not.toHaveAttribute("open")
  })
})
