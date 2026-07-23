// useResource hook：挂载取数回统一 {data,error,loading,refetch} / refetch 重取 /
// 失败回 error 不抛 / key 变化走各自缓存。
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useResource } from "@/lib/query/use-resource"
import { __resetResourceStore } from "@/lib/query/resource-store"

afterEach(() => {
  __resetResourceStore()
  vi.restoreAllMocks()
})

describe("useResource", () => {
  it("挂载即取数，回 data 并落 loading", async () => {
    const fetcher = vi.fn().mockResolvedValue("hello")
    const { result } = renderHook(() => useResource("r/1", fetcher))
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.data).toBe("hello")
    expect(result.current.error).toBeUndefined()
  })

  it("refetch 重取最新值", async () => {
    let n = 0
    const fetcher = vi.fn(() => Promise.resolve(`v${++n}`))
    const { result } = renderHook(() => useResource("r/2", fetcher))
    await waitFor(() => expect(result.current.data).toBe("v1"))
    act(() => result.current.refetch())
    await waitFor(() => expect(result.current.data).toBe("v2"))
  })

  it("失败回 error 不抛，data 为 undefined", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("boom"))
    const { result } = renderHook(() => useResource("r/3", fetcher))
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(result.current.data).toBeUndefined()
    expect(result.current.loading).toBe(false)
  })

  it("并发挂载同 key 只发一次请求", async () => {
    const fetcher = vi.fn().mockResolvedValue("shared")
    const { result: a } = renderHook(() => useResource("r/shared", fetcher))
    const { result: b } = renderHook(() => useResource("r/shared", fetcher))
    await waitFor(() => expect(a.current.data).toBe("shared"))
    await waitFor(() => expect(b.current.data).toBe("shared"))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
