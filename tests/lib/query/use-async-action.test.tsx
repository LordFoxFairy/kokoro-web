// useAsyncAction hook：提交态翻转 / 成功回 {ok:true} / 失败回 {ok:false,error} 不抛 /
// 错误经 error 暴露供 UI 分支 / 提交中忽略重复触发。
import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { useAsyncAction } from "@/lib/query/use-async-action"

describe("useAsyncAction", () => {
  it("成功：submitting 翻转后回落，回 {ok:true}", async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useAsyncAction(action))
    expect(result.current.submitting).toBe(false)

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.run()
    })
    expect(outcome).toEqual({ ok: true })
    expect(result.current.submitting).toBe(false)
    expect(result.current.error).toBeUndefined()
  })

  it("失败：不抛，回 {ok:false,error} 并把错误落到 error 供 UI 分支", async () => {
    const err = new Error("nope")
    const action = vi.fn().mockRejectedValue(err)
    const { result } = renderHook(() => useAsyncAction(action))

    let outcome: unknown
    await act(async () => {
      outcome = await result.current.run()
    })
    expect(outcome).toEqual({ ok: false, error: err })
    await waitFor(() => expect(result.current.error).toBe(err))
    expect(result.current.submitting).toBe(false)
  })

  it("提交中忽略重复触发（防连点）", async () => {
    let resolve!: () => void
    const action = vi.fn(() => new Promise<void>((r) => (resolve = r)))
    const { result } = renderHook(() => useAsyncAction(action))

    let first!: Promise<unknown>
    act(() => {
      first = result.current.run()
    })
    await waitFor(() => expect(result.current.submitting).toBe(true))
    // 第二次 run 在提交中：直接忽略，不再调用 action。
    await act(async () => {
      await result.current.run()
    })
    expect(action).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve()
      await first
    })
    expect(result.current.submitting).toBe(false)
  })

  it("reset 清除 error", async () => {
    const action = vi.fn().mockRejectedValue(new Error("x"))
    const { result } = renderHook(() => useAsyncAction(action))
    await act(async () => {
      await result.current.run()
    })
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    act(() => result.current.reset())
    expect(result.current.error).toBeUndefined()
  })
})
