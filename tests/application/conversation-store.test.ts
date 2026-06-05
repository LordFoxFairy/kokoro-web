import { describe, expect, it } from "vitest"

import {
  activeThreadOf,
  addConversation,
  conversationTitle,
  createConversationStore,
  parseStoredConversationStore,
  removeConversation,
  selectConversation,
  sortedConversations,
  withActiveThread,
} from "@/application/conversation-store"
import {
  appendUserMessage,
  createSessionStreamState,
} from "@/application/session-stream-reducer"

function threadWith(content: string) {
  return appendUserMessage(createSessionStreamState(), { id: "u1", content })
}

describe("conversation-store", () => {
  it("creates a store with one active empty conversation", () => {
    const store = createConversationStore("c1", 100)
    expect(store.activeId).toBe("c1")
    expect(store.conversations).toHaveLength(1)
    expect(store.conversations[0]?.title).toBe("新对话")
    expect(activeThreadOf(store).messages).toEqual([])
  })

  it("titles a conversation from the first user message, truncated", () => {
    expect(conversationTitle(createSessionStreamState())).toBe("新对话")
    expect(conversationTitle(threadWith("帮我写封信"))).toBe("帮我写封信")
    const long = conversationTitle(threadWith("题".repeat(40)))
    expect(long.endsWith("…")).toBe(true)
    expect(long.length).toBeLessThanOrEqual(25)
  })

  it("withActiveThread updates the active conversation's thread, title and updatedAt", () => {
    const store = createConversationStore("c1", 1)
    const next = withActiveThread(store, threadWith("你好世界"), 200)
    const active = next.conversations.find((entry) => entry.id === "c1")
    expect(active?.title).toBe("你好世界")
    expect(active?.updatedAt).toBe(200)
    expect(active?.thread.messages[0]?.content).toBe("你好世界")
  })

  it("addConversation prepends a new active empty conversation", () => {
    const next = addConversation(createConversationStore("c1", 1), "c2", 2)
    expect(next.activeId).toBe("c2")
    expect(next.conversations.map((entry) => entry.id)).toEqual(["c2", "c1"])
  })

  it("selectConversation switches active only to an existing id", () => {
    const store = addConversation(createConversationStore("c1", 1), "c2", 2)
    expect(selectConversation(store, "c1").activeId).toBe("c1")
    // unknown id is a no-op (never strands the UI on a missing conversation).
    expect(selectConversation(store, "nope").activeId).toBe("c2")
  })

  it("removeConversation drops it and re-activates the first remaining", () => {
    const store = addConversation(createConversationStore("c1", 1), "c2", 2)
    const next = removeConversation(store, "c2", "fresh", 3)
    expect(next.conversations.map((entry) => entry.id)).toEqual(["c1"])
    expect(next.activeId).toBe("c1")
  })

  it("removing the last conversation starts a fresh empty one", () => {
    const next = removeConversation(createConversationStore("c1", 1), "c1", "fresh", 3)
    expect(next.conversations).toHaveLength(1)
    expect(next.activeId).toBe("fresh")
    expect(next.conversations[0]?.thread.messages).toEqual([])
  })

  it("sortedConversations orders by updatedAt descending", () => {
    let store = createConversationStore("c1", 10)
    store = addConversation(store, "c2", 20)
    store = withActiveThread(selectConversation(store, "c1"), threadWith("x"), 30)
    expect(sortedConversations(store).map((entry) => entry.id)).toEqual([
      "c1",
      "c2",
    ])
  })

  it("parses a valid stored store and rejects malformed ones", () => {
    const store = withActiveThread(
      createConversationStore("c1", 1),
      threadWith("hi"),
      2,
    )
    const roundtrip = parseStoredConversationStore(
      JSON.parse(JSON.stringify(store)),
    )
    expect(roundtrip?.activeId).toBe("c1")
    expect(roundtrip?.conversations[0]?.thread.messages[0]?.content).toBe("hi")
    // 缺 conversations / 非对象根 → 拒绝并降级。
    expect(parseStoredConversationStore({ activeId: "x" })).toBeNull()
    expect(parseStoredConversationStore(null)).toBeNull()
  })
})
