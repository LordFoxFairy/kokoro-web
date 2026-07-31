import { describe, expect, it } from "vitest"

import {
  INITIAL_CONVERSATION_WINDOW,
  conversationWindow,
  conversationFollowState,
  earlierConversationWindowStart,
  initialConversationWindowStart,
  isNearConversationEnd,
  prependAnchoredScrollTop,
} from "../src/conversation-window.js"

describe("conversation viewport policy", () => {
  it("keeps the newest stable message identities in the initial window", () => {
    const messages = Array.from({ length: 125 }, (_, index) => Object.freeze({ id: `message-${index}` }))

    const start = initialConversationWindowStart(messages.length, INITIAL_CONVERSATION_WINDOW)
    const window = conversationWindow(messages, start)

    expect(window.hiddenCount).toBe(45)
    expect(window.visibleMessages).toHaveLength(80)
    expect(window.visibleMessages[0]?.id).toBe("message-45")
    expect(window.visibleMessages.at(-1)?.id).toBe("message-124")
  })

  it("keeps the visible start identity stable when streaming appends a message", () => {
    const initial = Array.from({ length: 125 }, (_, index) => Object.freeze({ id: `message-${index}` }))
    const start = initialConversationWindowStart(initial.length)
    const appended = [...initial, Object.freeze({ id: "message-125" })]

    expect(conversationWindow(appended, start).visibleMessages[0]?.id).toBe("message-45")
    expect(conversationWindow(appended, start).visibleMessages).toHaveLength(81)
  })

  it("reveals bounded older pages without moving the stable start past zero", () => {
    expect(earlierConversationWindowStart(45)).toBe(5)
    expect(earlierConversationWindowStart(5)).toBe(0)
    expect(earlierConversationWindowStart(0)).toBe(0)
  })

  it("follows streaming output only while the reader remains near the end", () => {
    expect(isNearConversationEnd({ scrollHeight: 1_000, scrollTop: 700, clientHeight: 240 })).toBe(true)
    expect(isNearConversationEnd({ scrollHeight: 1_000, scrollTop: 500, clientHeight: 240 })).toBe(false)
    expect(isNearConversationEnd({ scrollHeight: 200, scrollTop: 0, clientHeight: 400 })).toBe(true)
  })

  it("coalesces repeated streaming updates while the reader is detached", () => {
    const detached = conversationFollowState(
      { following: true, newContentAvailable: false },
      { type: "scrolled", nearEnd: false },
    )
    const firstUpdate = conversationFollowState(detached, { type: "content_received" })
    const secondUpdate = conversationFollowState(firstUpdate, { type: "content_received" })

    expect(secondUpdate).toEqual({ following: false, newContentAvailable: true })
    expect(conversationFollowState(secondUpdate, { type: "jump_to_latest" })).toEqual({
      following: true,
      newContentAvailable: false,
    })
  })

  it("preserves the viewed message offset when older history is prepended", () => {
    expect(prependAnchoredScrollTop(
      { scrollHeight: 1_000, scrollTop: 240 },
      1_650,
    )).toBe(890)
  })
})
