import { describe, expect, it } from "vitest"
import { MessageProcessor } from "@a2ui/web_core/v0_9"
import { kokoroChatCatalog } from "@/interfaces/a2ui/catalog"
import { feedA2uiLine } from "../a2ui-session"

describe("feedA2uiLine", () => {
  it("parses a JSON op line and feeds the processor incrementally", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    feedA2uiLine(processor, JSON.stringify({ version: "v0.9", createSurface: { surfaceId: "s", catalogId: "kokoro/chat/v1" } }))
    feedA2uiLine(processor, JSON.stringify({ version: "v0.9", updateComponents: { surfaceId: "s", components: [{ id: "root", component: "Thread", children: [] }] } }))
    expect(processor.model.getSurface("s")).toBeTruthy()
  })

  it("ignores malformed lines without throwing", () => {
    const processor = new MessageProcessor([kokoroChatCatalog])
    expect(() => feedA2uiLine(processor, "not json")).not.toThrow()
    expect(() => feedA2uiLine(processor, JSON.stringify({ nope: 1 }))).not.toThrow()
  })
})
