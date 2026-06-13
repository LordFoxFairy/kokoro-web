import { afterEach, describe, expect, it } from "vitest"

import {
  DISCLOSURE_CAP,
  DISCLOSURE_KEY,
  getDisclosure,
  setDisclosure,
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

  it("caps growth: keeps only the most-recent DISCLOSURE_CAP overrides", () => {
    for (let i = 0; i < DISCLOSURE_CAP + 5; i++) {
      setDisclosure(`seg_${i}`, true)
    }
    // 最旧的 5 个被淘汰，最近的仍在。
    expect(getDisclosure("seg_0")).toBeNull()
    expect(getDisclosure("seg_4")).toBeNull()
    expect(getDisclosure(`seg_${DISCLOSURE_CAP + 4}`)).toBe(true)
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
