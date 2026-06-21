import { describe, expect, it } from "vitest"

import { filterConversations } from "@/interfaces/session-stream/components/session-rail-search"

const conversations = [
  { id: "c1", title: "用 Zod 校验载荷" },
  { id: "c2", title: "Refactor the reducer" },
  { id: "c3", title: "今天的计划" },
]

describe("filterConversations", () => {
  it.each(["", "   "])(
    "returns all conversations for blank query %p",
    (query) => {
      expect(filterConversations(conversations, query)).toEqual(conversations)
    },
  )

  it("matches a case-insensitive title substring", () => {
    expect(filterConversations(conversations, "REDUCER")).toEqual([
      { id: "c2", title: "Refactor the reducer" },
    ])
  })

  it("matches CJK substrings", () => {
    expect(filterConversations(conversations, "计划")).toEqual([
      { id: "c3", title: "今天的计划" },
    ])
  })

  it("trims surrounding whitespace before matching", () => {
    expect(filterConversations(conversations, "  zod  ")).toEqual([
      { id: "c1", title: "用 Zod 校验载荷" },
    ])
  })

  it("returns an empty list when nothing matches", () => {
    expect(filterConversations(conversations, "无此会话")).toEqual([])
  })
})
