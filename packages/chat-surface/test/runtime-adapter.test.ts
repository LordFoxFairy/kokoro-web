import { describe, expect, it, vi } from "vitest"

import { createKokoroExternalStoreAdapter } from "../src/runtime/kokoro-external-store-adapter.js"
import { createChatProjection } from "../src/projection/store.js"

describe("assistant-ui adapter", () => {
  it("delegates one command without optimistically changing Kokoro state", async () => {
    const submit = vi.fn(async () => undefined)
    const projection = createChatProjection()
    const adapter = createKokoroExternalStoreAdapter(projection, { submit })

    await adapter.onNew({
      role: "user",
      content: [{ type: "text", text: "hello" }],
      attachments: [], metadata: { custom: {} }, createdAt: new Date(),
      parentId: null, sourceId: null, runConfig: undefined,
    })

    expect(submit).toHaveBeenCalledOnce()
    expect(projection.activeRunId).toBeNull()
  })

  it("does not advertise edit or reload without authoritative command ports", () => {
    const adapter = createKokoroExternalStoreAdapter(createChatProjection(), {
      submit: async () => undefined,
    })
    expect(adapter.onEdit).toBeUndefined()
    expect(adapter.onReload).toBeUndefined()
  })
})
