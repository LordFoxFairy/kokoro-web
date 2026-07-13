// 查询层模块级缓存 store 契约：缓存跨挂载留存 / in-flight 去重 / invalidate 前缀失活 /
// 竞态先发后至丢弃。以受控 deferred 精确编排 resolve 时序，不依赖真实计时。

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  __resetResourceStore,
  getResourceSnapshot,
  invalidate,
  refetchResource,
  subscribeResource,
} from "@/lib/query/resource-store"

afterEach(() => {
  __resetResourceStore()
})

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void }

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const noop = () => {}

describe("resource-store cache", () => {
  it("初挂载回 loading，取数落地后回 data", async () => {
    const d = deferred<string>()
    subscribeResource("k/1", () => d.promise, noop)
    expect(getResourceSnapshot<string>("k/1")).toMatchObject({ loading: true, data: undefined })

    d.resolve("value")
    await d.promise
    expect(getResourceSnapshot<string>("k/1")).toMatchObject({ loading: false, data: "value", error: undefined })
  })

  it("缓存跨挂载留存：重新订阅即刻见旧值不闪空（loading 期仍保留 data）", async () => {
    const first = deferred<string>()
    const unsub = subscribeResource("k/2", () => first.promise, noop)
    first.resolve("cached")
    await first.promise
    unsub()

    // 重新订阅触发后台刷新，但快照即刻仍是缓存值（data 不回 undefined）。
    const second = deferred<string>()
    subscribeResource("k/2", () => second.promise, noop)
    expect(getResourceSnapshot<string>("k/2")).toMatchObject({ data: "cached", loading: true })
  })
})

describe("resource-store 去重", () => {
  it("同 key 并发订阅只发一次真实请求", () => {
    const fetcher = vi.fn(() => deferred<string>().promise)
    subscribeResource("k/dup", fetcher, noop)
    subscribeResource("k/dup", fetcher, noop)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it("落地后广播给全部订阅者", async () => {
    const d = deferred<string>()
    const a = vi.fn()
    const b = vi.fn()
    subscribeResource("k/broadcast", () => d.promise, a)
    subscribeResource("k/broadcast", () => d.promise, b)
    a.mockClear()
    b.mockClear()
    d.resolve("done")
    await d.promise
    expect(a).toHaveBeenCalled()
    expect(b).toHaveBeenCalled()
  })
})

describe("resource-store invalidate", () => {
  it("有订阅者：前缀失活立即重取", async () => {
    let call = 0
    const fetcher = vi.fn(() => Promise.resolve(`v${++call}`))
    subscribeResource("hub/skills", fetcher, noop)
    await Promise.resolve()
    expect(getResourceSnapshot<string>("hub/skills").data).toBe("v1")

    invalidate("hub/")
    await Promise.resolve()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(getResourceSnapshot<string>("hub/skills").data).toBe("v2")
  })

  it("无订阅者：前缀失活丢缓存，下次挂载取新值", async () => {
    const first = deferred<string>()
    const unsub = subscribeResource("hub/quota", () => first.promise, noop)
    first.resolve("old")
    await first.promise
    unsub()

    invalidate("hub/")
    // 缓存已丢：重新挂载回 loading（无旧值残留），取新值。
    const second = deferred<string>()
    subscribeResource("hub/quota", () => second.promise, noop)
    expect(getResourceSnapshot<string>("hub/quota").data).toBeUndefined()
    second.resolve("new")
    await second.promise
    expect(getResourceSnapshot<string>("hub/quota").data).toBe("new")
  })

  it("前缀不匹配的 key 不受影响", async () => {
    const a = deferred<string>()
    subscribeResource("team/detail", () => a.promise, noop)
    a.resolve("keep")
    await a.promise
    invalidate("hub/")
    expect(getResourceSnapshot<string>("team/detail").data).toBe("keep")
  })
})

describe("resource-store 竞态先发后至丢弃", () => {
  it("旧发即使后到也不覆盖最新一发的结果", async () => {
    const stale = deferred<string>()
    const fresh = deferred<string>()

    refetchResource("k/race", () => stale.promise) // 第一发
    refetchResource("k/race", () => fresh.promise) // 第二发接管 activeSeq

    fresh.resolve("fresh")
    await fresh.promise
    expect(getResourceSnapshot<string>("k/race").data).toBe("fresh")

    // 旧发迟到：activeSeq 已属第二发，结果被丢弃。
    stale.resolve("stale")
    await stale.promise
    expect(getResourceSnapshot<string>("k/race").data).toBe("fresh")
  })
})

describe("resource-store 错误态", () => {
  it("失败回 error，refetch 后恢复", async () => {
    const bad = deferred<string>()
    refetchResource("k/err", () => bad.promise)
    bad.reject(new Error("boom"))
    await bad.promise.catch(noop)
    expect(getResourceSnapshot<string>("k/err")).toMatchObject({ loading: false, data: undefined })
    expect(getResourceSnapshot<string>("k/err").error).toBeInstanceOf(Error)

    const good = deferred<string>()
    refetchResource("k/err", () => good.promise)
    good.resolve("ok")
    await good.promise
    expect(getResourceSnapshot<string>("k/err")).toMatchObject({ data: "ok", error: undefined })
  })
})
