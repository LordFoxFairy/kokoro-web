import { describe, expect, it } from "vitest"

import {
  activeMode,
  activeThreadOf,
  addConversation,
  conversationTitle,
  createConversationStore,
  isActiveModeLocked,
  parseStoredConversationStore,
  removeConversation,
  selectConversation,
  setActiveMode,
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

  describe("agent mode (per-conversation, locks after first message)", () => {
    it("defaults to fast, switchable while the conversation is empty", () => {
      // 为什么重要：开聊前可自由选模式；新会话默认 fast。
      const store = createConversationStore("c1", 1)
      expect(activeMode(store)).toBe("fast")
      expect(isActiveModeLocked(store)).toBe(false)

      const thinking = setActiveMode(store, "thinking")
      expect(activeMode(thinking)).toBe("thinking")
    })

    it("locks once the conversation has a message (选中了就不能切换)", () => {
      // 为什么重要：用户的硬性要求——开聊后模式锁定，不可再切换。锁定的判定基于「有消息」。
      const started = withActiveThread(
        setActiveMode(createConversationStore("c1", 1), "thinking"),
        threadWith("你好"),
        2,
      )
      expect(activeMode(started)).toBe("thinking")
      expect(isActiveModeLocked(started)).toBe(true)
    })

    it("keeps each conversation's mode independent", () => {
      // 为什么重要：模式是每会话各自的；切换会话应看到各自选定的模式，互不串。
      const a = setActiveMode(createConversationStore("a", 1), "thinking")
      const withB = addConversation(a, "b", 2) // 新会话默认 fast 且置为活跃
      expect(activeMode(withB)).toBe("fast")
      expect(activeMode(selectConversation(withB, "a"))).toBe("thinking")
    })

    it("defaults mode to fast when parsing legacy stored entries without it", () => {
      // 为什么重要：旧版落盘无 mode 字段，必须向后兼容补 fast，绝不因新增字段判脏丢会话。
      const legacy = {
        activeId: "c1",
        conversations: [
          {
            id: "c1",
            title: "旧会话",
            updatedAt: 1,
            thread: createSessionStreamState(),
          },
        ],
      }
      const parsed = parseStoredConversationStore(legacy)
      expect(parsed).not.toBeNull()
      expect(parsed && activeMode(parsed)).toBe("fast")
    })
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
