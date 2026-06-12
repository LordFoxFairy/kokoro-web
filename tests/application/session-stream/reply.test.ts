import { afterEach, describe, expect, it, vi } from "vitest"

import { startSessionReply } from "@/application/session-stream/reply"
import {
  appendUserMessage,
  createSessionStreamState,
} from "@/application/session-stream/reducer"
import type { SessionStreamSnapshot } from "@/application/session-stream/transport"

// 降级是静默路径：这里钉死决策层本身（POST 失败→preview / 成功→live / close 竞态），
// 模拟器内部行为由 simulator.test.ts 负责。

function makeArgs() {
  const snapshots: SessionStreamSnapshot[] = []
  const settled: string[] = []
  const onLive = vi.fn()
  const initialState = appendUserMessage(createSessionStreamState(), {
    id: "user_1",
    content: "你好",
  })
  return {
    snapshots,
    settled,
    onLive,
    input: {
      input: "你好",
      initialState,
      onState: (snapshot: SessionStreamSnapshot) => snapshots.push(snapshot),
      onSettled: (mode: string) => settled.push(mode),
      onLive,
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("startSessionReply — live→preview 降级决策层", () => {
  it("POST 失败时降级本地预览：完整收束为 completed,onLive 从未触发", async () => {
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))

    const { snapshots, settled, onLive, input } = makeArgs()
    startSessionReply(input)

    // 让 POST 失败的微任务先落地，再驱动模拟流的全部定时器。
    await vi.runAllTimersAsync()

    expect(settled).toEqual(["preview"])
    expect(onLive).not.toHaveBeenCalled()
    const final = snapshots.at(-1)
    expect(final?.runStatus).toBe("completed")
    expect(final?.messages.some((m) => m.role === "assistant" && m.content.length > 0)).toBe(true)
  })

  it("发起后立即 close：降级被竞态守卫抑制，零快照零收束", async () => {
    vi.useFakeTimers()
    let rejectPost: (reason: Error) => void = () => {}
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () => new Promise((_, reject) => { rejectPost = reject }),
      ),
    )

    const { snapshots, settled, onLive, input } = makeArgs()
    const handle = startSessionReply(input)
    handle.close()
    rejectPost(new Error("late failure"))
    await vi.runAllTimersAsync()

    expect(snapshots).toEqual([])
    expect(settled).toEqual([])
    expect(onLive).not.toHaveBeenCalled()
  })

  it("POST 成功确立 live 链路：onLive 恰一次,不启动 preview 降级", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200 }),
    )

    const { snapshots, settled, onLive, input } = makeArgs()
    startSessionReply(input)
    await vi.runAllTimersAsync()

    expect(onLive).toHaveBeenCalledTimes(1)
    // jsdom 无 EventSource：live 流保持静默不 settle；关键是 preview 没有被误启动。
    expect(settled).toEqual([])
    expect(snapshots).toEqual([])
  })
})
