import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { startSessionReply } from "@/application/session-stream/reply"
import {
  appendUserMessage,
  createSessionStreamState,
} from "@/application/session-stream/reducer"
import type { SessionStreamSnapshot } from "@/application/session-stream/transport"

// 桩掉降级模拟器/传输层以注入故障；vi.mock 被提升到文件顶,
// mock fn 须经 vi.hoisted 同步提升以避开 TDZ。默认转发真实实现,仅故障用例覆盖。
const { simulateMock, consumeMock } = vi.hoisted(() => ({
  simulateMock: vi.fn(),
  consumeMock: vi.fn(),
}))
vi.mock("@/application/session-stream/simulator", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/application/session-stream/simulator")>()
  return { ...actual, simulateAssistantReply: simulateMock }
})
vi.mock("@/application/session-stream/transport", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/application/session-stream/transport")>()
  return { ...actual, consumeLiveSession: consumeMock }
})

beforeEach(async () => {
  const simActual = await vi.importActual<
    typeof import("@/application/session-stream/simulator")
  >("@/application/session-stream/simulator")
  const transportActual = await vi.importActual<
    typeof import("@/application/session-stream/transport")
  >("@/application/session-stream/transport")
  simulateMock.mockReset()
  simulateMock.mockImplementation(simActual.simulateAssistantReply)
  consumeMock.mockReset()
  consumeMock.mockImplementation(transportActual.consumeLiveSession)
})

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

  it("fetch 中途失败：降级 promise 被消费,不泄漏 unhandledrejection", async () => {
    // [硬化] void(async IIFE) 把链路 reject 静默吞掉；改为显式消费后,
    // 任何 live 链路异常都不得逃逸成进程级 unhandledRejection。
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)

    const { settled, input } = makeArgs()
    startSessionReply(input)
    await vi.runAllTimersAsync()

    process.off("unhandledRejection", onUnhandled)
    expect(settled).toEqual(["preview"])
    expect(unhandled).toEqual([])
  })

  it("降级模拟器同步抛错：异常不逃逸成 unhandledRejection", async () => {
    // [硬化] 旧 catch{fallbackToPreview()} 里若 fallback 自身同步抛错,
    // 异常会逃出 async IIFE 成进程级 unhandledRejection 被静默丢。
    // 硬化后该异常必须被就地吞住,不污染全局。
    vi.useFakeTimers()
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
    simulateMock.mockImplementation(() => {
      throw new Error("simulator boom")
    })

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)

    const { input } = makeArgs()
    startSessionReply(input)
    await vi.runAllTimersAsync()

    process.off("unhandledRejection", onUnhandled)
    // fallback 被调用过(确认走到降级),且其抛错未逃逸成全局未处理 rejection。
    expect(simulateMock).toHaveBeenCalledTimes(1)
    expect(unhandled).toEqual([])
  })

  it("live 确立后 onLive 抛错：旧 live 句柄被关闭,不与降级双开泄漏", async () => {
    // [硬化] consumeLiveSession 已成功(SSE 已开),onLive 回调却抛错:
    // 若直接降级而不关掉已开的 live 句柄,会与 preview 双开并泄漏 EventSource。
    vi.useFakeTimers()
    const liveClose = vi.fn()
    consumeMock.mockResolvedValue({ close: liveClose, markToolRejected: () => {} })

    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)

    const { input, onLive } = makeArgs()
    onLive.mockImplementation(() => {
      throw new Error("onLive boom")
    })
    startSessionReply(input)
    await vi.runAllTimersAsync()

    process.off("unhandledRejection", onUnhandled)
    // 已开的 live 句柄必须被关闭(否则 EventSource 泄漏),异常不逃逸成全局 rejection。
    expect(liveClose).toHaveBeenCalledTimes(1)
    expect(unhandled).toEqual([])
  })
})
