// 待批注册表（HITL-NOTIFY）：跨会话待批的客户端真源——登记后切走仍保留、幂等、可订阅。
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  readAwaiting,
  serverAwaiting,
  setAwaiting,
  subscribeAwaiting,
} from "@/ui/hitl/awaiting-store"

// 模块级单例：每例后把本例登记过的 id 全部销账，避免跨例串味。
afterEach(() => {
  for (const id of [...readAwaiting()]) {
    setAwaiting(id, false)
  }
})

describe("awaiting-store", () => {
  it("登记一个会话后可读到", () => {
    setAwaiting("ses_A", true)
    expect(readAwaiting().has("ses_A")).toBe(true)
  })

  it("跨会话保留：登记 B 不清除 A（切走后 A 徽标仍在）", () => {
    setAwaiting("ses_A", true)
    setAwaiting("ses_B", true)
    expect(readAwaiting().has("ses_A")).toBe(true)
    expect(readAwaiting().has("ses_B")).toBe(true)
  })

  it("销账只影响目标会话", () => {
    setAwaiting("ses_A", true)
    setAwaiting("ses_B", true)
    setAwaiting("ses_A", false)
    expect(readAwaiting().has("ses_A")).toBe(false)
    expect(readAwaiting().has("ses_B")).toBe(true)
  })

  it("幂等：无变更不换快照引用、不通知", () => {
    setAwaiting("ses_A", true)
    const before = readAwaiting()
    const listener = vi.fn()
    const unsub = subscribeAwaiting(listener)
    setAwaiting("ses_A", true) // 已登记，重复登记应无操作
    expect(readAwaiting()).toBe(before)
    expect(listener).not.toHaveBeenCalled()
    unsub()
  })

  it("变更通知订阅者，退订后不再通知", () => {
    const listener = vi.fn()
    const unsub = subscribeAwaiting(listener)
    setAwaiting("ses_X", true)
    expect(listener).toHaveBeenCalledTimes(1)
    unsub()
    setAwaiting("ses_X", false)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("SSR 快照恒空且引用稳定", () => {
    expect(serverAwaiting().size).toBe(0)
    expect(serverAwaiting()).toBe(serverAwaiting())
  })
})
