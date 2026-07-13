// 会话清单水合 hook：首页取数 / 复合游标翻页追加 / refreshSignal 变化重取首页 / 失败回错误态。
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SessionClient } from "@/engine/client"
import { useSessionList } from "@/ui/rail/use-session-list"

function item(id: string, updatedAt: string) {
  return { session_id: id, title: `chat ${id}`, updated_at: updatedAt }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("useSessionList", () => {
  it("hydrates the first page and exposes hasMore from next_cursor", async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValue({ sessions: [item("a", "2026-07-13T00:00:00Z")], next_cursor: "cur_2" })
    const client = { listSessions } as Pick<SessionClient, "listSessions">
    const { result } = renderHook(() => useSessionList(client, 0))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.entries).toHaveLength(1)
    expect(result.current.entries[0]).toEqual({ id: "a", title: "chat a", updatedAt: "2026-07-13T00:00:00Z" })
    expect(result.current.hasMore).toBe(true)
  })

  it("appends the next page on loadMore and stops when the cursor runs out", async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce({ sessions: [item("a", "t1")], next_cursor: "cur_2" })
      .mockResolvedValueOnce({ sessions: [item("b", "t2")] })
    const client = { listSessions } as Pick<SessionClient, "listSessions">
    const { result } = renderHook(() => useSessionList(client, 0))
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
    expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"])
    expect(result.current.hasMore).toBe(false)
    expect(listSessions).toHaveBeenNthCalledWith(2, "cur_2")
  })

  it("refetches the first page when refreshSignal changes", async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce({ sessions: [item("a", "t1")] })
      .mockResolvedValueOnce({ sessions: [item("a", "t1"), item("c", "t3")] })
    const client = { listSessions } as Pick<SessionClient, "listSessions">
    const { result, rerender } = renderHook(
      ({ signal }: { signal: number }) => useSessionList(client, signal),
      { initialProps: { signal: 0 } },
    )
    await waitFor(() => expect(result.current.entries).toHaveLength(1))
    rerender({ signal: 1 })
    await waitFor(() => expect(result.current.entries).toHaveLength(2))
  })

  it("surfaces an error state without throwing when the fetch fails", async () => {
    const listSessions = vi.fn().mockRejectedValue(new Error("boom"))
    const client = { listSessions } as Pick<SessionClient, "listSessions">
    const { result } = renderHook(() => useSessionList(client, 0))
    await waitFor(() => expect(result.current.error).toBe(true))
    expect(result.current.entries).toEqual([])
  })
})
