import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import { createPersistedStore } from "@/lib/persisted-store"

const KEY = "kokoro-web.test-store"
const schema = z.object({ count: z.number(), label: z.string() }).strict()

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

function build() {
  return createPersistedStore({ key: KEY, schema })
}

describe("read：脏数据一律降空态", () => {
  it.each([
    ["坏 JSON", "{not json"],
    ["schema 漂移（缺字段）", JSON.stringify({ count: 1 })],
    ["注入未知字段", JSON.stringify({ count: 1, label: "a", evil: true })],
    ["类型错", JSON.stringify({ count: "1", label: "a" })],
    ["整体标量", JSON.stringify(42)],
  ])("%s → null", (_label, raw) => {
    window.localStorage.setItem(KEY, raw)
    expect(build().read()).toBeNull()
  })

  it("无落盘 → null；合法落盘恢复且缓存稳定引用", () => {
    const store = build()
    expect(store.read()).toBeNull()
    window.localStorage.setItem(KEY, JSON.stringify({ count: 1, label: "a" }))
    const first = store.read()
    expect(first).toEqual({ count: 1, label: "a" })
    // raw 未变时返回同一对象（useSyncExternalStore 快照要求）。
    expect(store.read()).toBe(first)
  })
})

describe("write / subscribe", () => {
  it("写入即落盘 + 通知；read 直接返回内存值", () => {
    const store = build()
    const onChange = vi.fn()
    store.subscribe(onChange)
    const value = { count: 2, label: "b" }
    store.write(value)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(store.read()).toBe(value)
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "")).toEqual(value)
  })

  it("配额写入失败：内存态照常生效，不回读旧盘值", () => {
    const store = build()
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    const value = { count: 3, label: "c" }
    store.write(value)
    expect(store.read()).toBe(value)
  })

  it("跨标签页 storage 事件：本键失效缓存并通知；他键忽略", () => {
    const store = build()
    const onChange = vi.fn()
    store.subscribe(onChange)
    window.dispatchEvent(new StorageEvent("storage", { key: "other:key" }))
    expect(onChange).not.toHaveBeenCalled()
    window.localStorage.setItem(KEY, JSON.stringify({ count: 4, label: "d" }))
    window.dispatchEvent(new StorageEvent("storage", { key: KEY }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(store.read()).toEqual({ count: 4, label: "d" })
  })

  it("退订后不再收到通知", () => {
    const store = build()
    const onChange = vi.fn()
    const unsubscribe = store.subscribe(onChange)
    unsubscribe()
    store.write({ count: 5, label: "e" })
    expect(onChange).not.toHaveBeenCalled()
  })
})
