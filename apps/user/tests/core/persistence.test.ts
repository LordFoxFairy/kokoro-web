import { describe, expect, it } from "vitest"

import { addConversation, setActiveMode } from "@/core/conversations"
import { parseStoredConversationStore } from "@/core/persistence"

type StoredRaw = {
  conversations: Record<string, unknown>[]
} & Record<string, unknown>

describe("ConversationStore 落盘往返（只存 UI 偏好与列表索引）", () => {
  it("JSON 往返恢复等价 store", () => {
    let store = addConversation(null, "conv_1", 1000, "thinking")
    store = addConversation(store, "conv_2", 2000)
    store = setActiveMode(store, "thinking")
    const raw: unknown = JSON.parse(JSON.stringify(store))
    expect(parseStoredConversationStore(raw)).toEqual(store)
  })

  it.each<[string, (raw: StoredRaw) => void]>([
    ["缺 activeId", (raw) => {
      delete raw["activeId"]
    }],
    ["注入未知字段", (raw) => {
      raw["evil"] = 1
    }],
    ["mode 枚举越界", (raw) => {
      raw.conversations[0]!["mode"] = "turbo"
    }],
    // 旧版形状（v2 之前把整条线程落盘）：thread 字段即未知字段，整体判脏重建。
    ["旧版携带 thread", (raw) => {
      raw.conversations[0]!["thread"] = { messages: [] }
    }],
    ["旧版携带 pendingRunId", (raw) => {
      raw.conversations[0]!["pendingRunId"] = "run_1"
    }],
  ])("落盘漂移（%s）→ null 降空态", (_label, mutate) => {
    const raw = JSON.parse(JSON.stringify(addConversation(null, "conv_1", 1000))) as StoredRaw
    mutate(raw)
    expect(parseStoredConversationStore(raw)).toBeNull()
  })

  it.each([["not-an-object"], [null], [""], [[]], [{}]])("脏盘面边界 %j 不崩溃降 null", (raw) => {
    expect(parseStoredConversationStore(raw)).toBeNull()
  })
})
