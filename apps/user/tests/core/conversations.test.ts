import { describe, expect, it } from "vitest"

import {
  activeMode,
  addConversation,
  conversationTitle,
  removeConversation,
  selectConversation,
  setActiveMode,
  sortedConversations,
  touchActive,
} from "@/core/conversations"
import type { SessionMessage } from "@/core/state"

function userMessage(content: string): SessionMessage {
  return { id: "usr_1", role: "user", content, runId: "usr_1" }
}

describe("标题回退派生", () => {
  it.each([
    ["无用户消息为空串", null, ""],
    ["取首条用户消息", "hello world", "hello world"],
    ["超长截断加省略号", "x".repeat(30), `${"x".repeat(24)}…`],
    ["空白输入视同无标题", "   ", ""],
  ])("%s", (_label, content, expected) => {
    const messages = content === null ? [] : [userMessage(content)]
    expect(conversationTitle(messages)).toBe(expected)
  })

  it("touchActive 同步刷新活跃项标题与更新时间", () => {
    let store = addConversation(null, "conv_1", 1000)
    store = addConversation(store, "conv_2", 1500)
    store = touchActive(store, "server title", 2000)
    expect(store.conversations.find((entry) => entry.id === "conv_2")).toMatchObject({
      title: "server title",
      updatedAt: 2000,
    })
    expect(store.conversations.find((entry) => entry.id === "conv_1")).toMatchObject({
      title: "",
      updatedAt: 1000,
    })
  })
})

describe("模式（纯 UI 偏好）", () => {
  it("setActiveMode 只作用于活跃会话", () => {
    let store = addConversation(null, "conv_1", 1000)
    store = setActiveMode(store, "thinking")
    expect(activeMode(store)).toBe("thinking")
    store = addConversation(store, "conv_2", 2000)
    expect(activeMode(store)).toBe("fast")
  })
})

describe("列表操作", () => {
  it("删除活跃项激活余下首个；删空则以 fallback 起新会话", () => {
    let store = addConversation(null, "conv_1", 1000)
    store = addConversation(store, "conv_2", 2000)
    store = removeConversation(store, "conv_2", "conv_fb", 3000)
    expect(store.activeId).toBe("conv_1")
    store = removeConversation(store, "conv_1", "conv_fb", 4000)
    expect(store.activeId).toBe("conv_fb")
    expect(store.conversations).toHaveLength(1)
  })

  it("选择不存在的会话保持原状", () => {
    const store = addConversation(null, "conv_1", 1000)
    expect(selectConversation(store, "ghost")).toBe(store)
  })

  it("sortedConversations 按更新时间倒序", () => {
    let store = addConversation(null, "conv_1", 1000)
    store = addConversation(store, "conv_2", 500)
    expect(sortedConversations(store).map((entry) => entry.id)).toEqual(["conv_1", "conv_2"])
  })
})
