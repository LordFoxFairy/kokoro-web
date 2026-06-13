import { afterEach, describe, expect, it } from "vitest"

import {
  DISCLOSURE_CAP,
  DISCLOSURE_KEY,
  getDisclosure,
  setDisclosure,
  subscribeDisclosure,
  __resetDisclosureCacheForTest,
} from "@/application/session-stream/process-disclosure"

afterEach(() => {
  window.localStorage.clear()
  __resetDisclosureCacheForTest()
})

describe("process-disclosure store", () => {
  it("returns null for a segment with no manual override (defaults to live signal)", () => {
    expect(getDisclosure("run_1:seg_0001")).toBeNull()
  })

  it("persists a manual override and reads it back across a fresh cache (survives reload)", () => {
    setDisclosure("run_1:seg_0001", true)
    expect(getDisclosure("run_1:seg_0001")).toBe(true)
    // 模拟刷新：清缓存但保留 localStorage，再读应仍命中（落盘生效）。
    __resetDisclosureCacheForTest()
    expect(getDisclosure("run_1:seg_0001")).toBe(true)
  })

  it("stores false (manual collapse) distinctly from null (no override)", () => {
    setDisclosure("run_1:seg_0001", false)
    expect(getDisclosure("run_1:seg_0001")).toBe(false)
    expect(getDisclosure("run_1:seg_0002")).toBeNull()
  })

  it("overwrites an existing override in place", () => {
    setDisclosure("s", true)
    setDisclosure("s", false)
    expect(getDisclosure("s")).toBe(false)
  })

  it("caps growth: evicts oldest, keeps middle + most-recent overrides", () => {
    for (let i = 0; i < DISCLOSURE_CAP + 5; i++) {
      setDisclosure(`seg_${i}`, true)
    }
    // 最旧的 5 个被淘汰。
    expect(getDisclosure("seg_0")).toBeNull()
    expect(getDisclosure("seg_4")).toBeNull()
    // 中间存活键也仍在（不只首尾）。
    expect(getDisclosure("seg_5")).toBe(true)
    expect(getDisclosure(`seg_${Math.floor(DISCLOSURE_CAP / 2)}`)).toBe(true)
    // 最近的仍在。
    expect(getDisclosure(`seg_${DISCLOSURE_CAP + 4}`)).toBe(true)
  })

  it("LRU-touch: re-setting an old key moves it to most-recent so it survives eviction", () => {
    // 守护 delete-reinsert 的「救活」分支：先写满到临界，再 re-touch seg_0（移到末尾），
    // 然后再多写一个把容量挤过界——被淘汰的应是次旧的 seg_1，而非刚被 touch 的 seg_0。
    for (let i = 0; i < DISCLOSURE_CAP; i++) {
      setDisclosure(`seg_${i}`, true)
    }
    setDisclosure("seg_0", false) // re-touch → 移到最近
    setDisclosure("overflow", true) // 越界一个 → 淘汰最旧
    expect(getDisclosure("seg_0")).toBe(false) // 被救活，仍在（且值更新）
    expect(getDisclosure("seg_1")).toBeNull() // 次旧的被淘汰
  })

  it("ignores non-boolean persisted values (degrades to null, never leaks string/number)", () => {
    // localStorage 是不可信边界：合法 JSON 对象但 value 形状错误（被篡改/旧格式）不得泄漏成脏开关。
    window.localStorage.setItem(
      DISCLOSURE_KEY,
      JSON.stringify({ "run_1:seg_0001": "yes", x: 1, "run_1:seg_0002": false }),
    )
    __resetDisclosureCacheForTest()
    expect(getDisclosure("run_1:seg_0001")).toBeNull()
    expect(getDisclosure("x")).toBeNull()
    expect(getDisclosure("run_1:seg_0002")).toBe(false) // 合法布尔仍保留
  })

  it("cross-tab: a storage event invalidates the cache and notifies subscribers", () => {
    // 对齐姊妹 use-persistent-store：另一标签页写盘 → storage 事件 → 本页缓存失效 + 重渲染。
    setDisclosure("seg_a", true)
    let notified = 0
    const unsub = subscribeDisclosure(() => {
      notified += 1
    })
    // 模拟另一标签页直接写盘 + 派发 storage 事件（jsdom 不自动跨页派发）。
    window.localStorage.setItem(
      DISCLOSURE_KEY,
      JSON.stringify({ seg_a: true, seg_b: true }),
    )
    window.dispatchEvent(new StorageEvent("storage", { key: DISCLOSURE_KEY }))
    expect(notified).toBeGreaterThan(0)
    // 缓存已失效 → 回读到另一标签页写入的 seg_b。
    expect(getDisclosure("seg_b")).toBe(true)
    unsub()
  })

  it("cross-tab: a local write after another tab's write does not lose the other tab's key", () => {
    setDisclosure("seg_a", true)
    // 另一标签页写盘（不经本 store 的 persist），缓存仍是旧的 {seg_a}。
    window.localStorage.setItem(
      DISCLOSURE_KEY,
      JSON.stringify({ seg_a: true, seg_b: true }),
    )
    // 本页再写 seg_c：load() 比对 raw 发现变化 → 回读最新盘面 → 合并，不丢 seg_b。
    setDisclosure("seg_c", true)
    expect(getDisclosure("seg_b")).toBe(true)
    expect(getDisclosure("seg_c")).toBe(true)
  })

  it("survives corrupt persisted JSON (degrades to no overrides, never throws)", () => {
    window.localStorage.setItem(DISCLOSURE_KEY, "{not json")
    __resetDisclosureCacheForTest()
    expect(getDisclosure("s")).toBeNull()
    // 仍可正常写入。
    setDisclosure("s", true)
    expect(getDisclosure("s")).toBe(true)
  })
})
