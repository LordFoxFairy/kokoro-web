import { describe, expect, it } from "vitest"

import { createChatProjectionStore } from "../src/projection/store.js"

describe("Chat projection", () => {
  it("replaces history on snapshot rehydrate and exposes legacy repair", () => {
    const store = createChatProjectionStore()
    const snapshot = {
      session: { session_id: "s", title: "t", owner_id: "o", created_at: "a", updated_at: "b" },
      messages: [{ message_id: "m", role: "user" as const, content: "hello", status: "completed" as const, created_at: "a" }],
      pending_pauses: [], files: [], deliveries: [], event_watermark: 1,
    }
    store.dispatch({ type: "snapshot", snapshot })
    store.dispatch({ type: "snapshot", snapshot: { ...snapshot, messages: [] } })

    expect(store.getSnapshot().messages).toEqual([])
    expect(store.getSnapshot().repair).toEqual({ required: true, reason: "legacy_flat_snapshot" })
  })
})
