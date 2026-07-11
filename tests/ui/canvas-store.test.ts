// canvas 事件总线 store 规格：按会话键各存一槽的开合记忆；「closed」只由手动关闭记账。

import { beforeEach, describe, expect, it, vi } from "vitest"

import { applySessionEvent } from "@/core/reducer"
import { createSessionStreamState } from "@/core/state"
import {
  canvasSlot,
  closeCanvas,
  openCanvas,
  readCanvasState,
  reopenCanvas,
  resetCanvasStore,
  resolveCanvasContent,
  subscribeCanvas,
  toggleCanvasFullscreen,
} from "@/ui/canvas/canvas-store"

import { makeEvent } from "../core/fixtures"

beforeEach(resetCanvasStore)

const FILE_REF = { kind: "file", path: "out/a.md" } as const

describe("开合与会话级记忆", () => {
  it("open：换引用快照 + 订阅方收到通知", () => {
    const onChange = vi.fn()
    const unsubscribe = subscribeCanvas(onChange)
    const before = readCanvasState()
    openCanvas("conv_1", FILE_REF)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(readCanvasState()).not.toBe(before)
    expect(canvasSlot(readCanvasState(), "conv_1")).toMatchObject({
      open: true,
      content: FILE_REF,
    })
    unsubscribe()
  })

  it("手动关闭记 closed：内容留槽可重开，且退出全屏", () => {
    openCanvas("conv_1", FILE_REF)
    toggleCanvasFullscreen("conv_1")
    closeCanvas("conv_1")
    expect(canvasSlot(readCanvasState(), "conv_1")).toMatchObject({
      open: false,
      fullscreen: false,
      content: FILE_REF,
    })
    reopenCanvas("conv_1")
    expect(canvasSlot(readCanvasState(), "conv_1").open).toBe(true)
  })

  it("再次打开内容覆盖此前的手动关闭（点击产物即打开意图）", () => {
    openCanvas("conv_1", FILE_REF)
    closeCanvas("conv_1")
    openCanvas("conv_1", { kind: "delivery", contentHash: "hash_a" })
    expect(canvasSlot(readCanvasState(), "conv_1")).toMatchObject({
      open: true,
      content: { kind: "delivery", contentHash: "hash_a" },
    })
  })

  it("按键隔离：conv_1 的手动关闭不影响 conv_2；空键/未知键回落关闭空槽", () => {
    openCanvas("conv_1", FILE_REF)
    openCanvas("conv_2", { kind: "file", path: "out/b.md" })
    closeCanvas("conv_1")
    expect(canvasSlot(readCanvasState(), "conv_1").open).toBe(false)
    expect(canvasSlot(readCanvasState(), "conv_2").open).toBe(true)
    expect(canvasSlot(readCanvasState(), null)).toMatchObject({ open: false, content: null })
    expect(canvasSlot(readCanvasState(), "conv_x")).toMatchObject({ open: false, content: null })
  })

  it("空槽 reopen 是 no-op（无内容无可开）", () => {
    reopenCanvas("conv_1")
    expect(canvasSlot(readCanvasState(), "conv_1").open).toBe(false)
  })
})

describe("resolveCanvasContent（引用 → 线程活数据）", () => {
  it("file：命中清单取实体，未及刷新的新文件以 MIME 兜底", () => {
    const thread = {
      ...createSessionStreamState(),
      files: [{ path: "out/a.md", mime: "text/markdown", bytes: 12 }],
    }
    expect(resolveCanvasContent({ kind: "file", path: "out/a.md" }, thread)).toEqual({
      kind: "file",
      file: { path: "out/a.md", mime: "text/markdown", bytes: 12 },
    })
    expect(resolveCanvasContent({ kind: "file", path: "out/new.txt" }, thread)).toEqual({
      kind: "file",
      file: { path: "out/new.txt", mime: "text/plain", bytes: 0 },
    })
  })

  it("delivery：按 contentHash 命中；缺位返回 null（不渲染悬空面板）", () => {
    const thread = applySessionEvent(
      createSessionStreamState(),
      makeEvent("delivery.created", {
        path: "out/report.md",
        title: "调研报告",
        mime: "text/markdown",
        size: 2048,
        content_hash: "hash_a",
      }),
    )
    const hit = resolveCanvasContent({ kind: "delivery", contentHash: "hash_a" }, thread)
    expect(hit?.kind === "delivery" ? hit.delivery.title : null).toBe("调研报告")
    expect(resolveCanvasContent({ kind: "delivery", contentHash: "hash_x" }, thread)).toBeNull()
  })

  it("tool：优先线程活数据（结果回流即更新），线程缺位用点击时快照兜底", () => {
    const snapshot = {
      id: "tool_1",
      name: "write_file",
      args: { path: "/tmp/a" },
      status: "running",
    } as const
    let thread = applySessionEvent(
      createSessionStreamState(),
      makeEvent("tool.invoked", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "write_file",
        args: { path: "/tmp/a" },
      }),
    )
    thread = applySessionEvent(
      thread,
      makeEvent("tool.returned", {
        segment_id: "seg_1",
        tool_id: "tool_1",
        name: "write_file",
        result: "ok",
        is_error: false,
      }),
    )
    const live = resolveCanvasContent(
      { kind: "tool", runId: "run_1", toolId: "tool_1", snapshot },
      thread,
    )
    expect(live?.kind === "tool" ? live.tool : null).toMatchObject({ status: "done", result: "ok" })
    const fallback = resolveCanvasContent(
      { kind: "tool", runId: "run_gone", toolId: "tool_1", snapshot },
      createSessionStreamState(),
    )
    expect(fallback?.kind === "tool" ? fallback.tool : null).toBe(snapshot)
  })
})
