import { afterEach, describe, expect, it, vi } from "vitest"

import { authConfig } from "@/lib/server/auth"
import * as upstream from "@/lib/server/upstream"

const CONFIGURED_ENV = {
  NODE_ENV: "production" as const,
  KOKORO_WEB_SESSION_SECRET: "test-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
}

describe("Web upstream timeout configuration", () => {
  it("uses the bounded default when the timeout is omitted", () => {
    expect(authConfig({ ...CONFIGURED_ENV })?.upstreamTimeoutMs).toBe(10_000)
  })

  it.each(["0", "99", "60001", "1.5", "ten", "  "])(
    "rejects invalid configured timeout %j instead of entering preview mode",
    (raw) => {
      expect(() => authConfig({ ...CONFIGURED_ENV, KOKORO_WEB_UPSTREAM_TIMEOUT_MS: raw })).toThrow(
        /KOKORO_WEB_UPSTREAM_TIMEOUT_MS/,
      )
    },
  )

  it("rejects an invalid Site deadline during auth/server assembly", () => {
    expect(() => authConfig({ ...CONFIGURED_ENV, KOKORO_SITE_RESOLVE_TIMEOUT_MS: "6000" })).toThrow(
      /KOKORO_SITE_RESOLVE_TIMEOUT_MS/,
    )
  })

  it("accepts the inclusive timeout range", () => {
    expect(authConfig({ ...CONFIGURED_ENV, KOKORO_WEB_UPSTREAM_TIMEOUT_MS: "100" })?.upstreamTimeoutMs).toBe(100)
    expect(authConfig({ ...CONFIGURED_ENV, KOKORO_WEB_UPSTREAM_TIMEOUT_MS: "60000" })?.upstreamTimeoutMs).toBe(
      60_000,
    )
  })

  it("still reports preview only when required service configuration is absent", () => {
    expect(authConfig({ NODE_ENV: "production", KOKORO_WEB_UPSTREAM_TIMEOUT_MS: "1000" })).toBeNull()
  })
})

describe("Web upstream deadline", () => {
  it("provides one lifecycle helper instead of route-local timers", () => {
    expect(typeof (upstream as Record<string, unknown>).withUpstreamDeadline).toBe("function")
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("aborts a pending upstream and identifies only its own deadline as timeout", async () => {
    vi.useFakeTimers()
    let upstreamSignal: AbortSignal | null = null
    const pending = upstream.withUpstreamDeadline(undefined, 100, async (signal) => {
      upstreamSignal = signal
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    })
    const outcome = pending.then(
      (value) => ({ kind: "resolved", value }) as const,
      (error: unknown) => ({ kind: "rejected", error }) as const,
    )

    await vi.advanceTimersByTimeAsync(100)

    const result = await outcome
    expect(result.kind).toBe("rejected")
    expect(result.kind === "rejected" && upstream.isUpstreamTimeoutError(result.error)).toBe(true)
    expect(upstreamSignal).not.toBeNull()
    expect(upstreamSignal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("does not relabel a client abort as a gateway timeout", async () => {
    vi.useFakeTimers()
    const client = new AbortController()
    let upstreamSignal: AbortSignal | null = null
    const pending = upstream.withUpstreamDeadline(client.signal, 100, async (signal) => {
      upstreamSignal = signal
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true })
      })
    })
    const rejected = expect(pending).rejects.not.toSatisfy(upstream.isUpstreamTimeoutError)

    client.abort(new DOMException("client disconnected", "AbortError"))

    await rejected
    expect(upstreamSignal).not.toBeNull()
    expect(upstreamSignal!.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("still reports timeout when a bounded body reader normalizes the abort", async () => {
    vi.useFakeTimers()
    const pending = upstream.withUpstreamDeadline(undefined, 100, async (signal) => {
      await new Promise<void>((resolve) => {
        signal.addEventListener("abort", () => resolve(), { once: true })
      })
      return null
    })
    const outcome = pending.then(
      (value) => ({ kind: "resolved", value }) as const,
      (error: unknown) => ({ kind: "rejected", error }) as const,
    )

    await vi.advanceTimersByTimeAsync(100)

    const result = await outcome
    expect(result.kind).toBe("rejected")
    expect(result.kind === "rejected" && upstream.isUpstreamTimeoutError(result.error)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("clears the deadline after a successful upstream operation", async () => {
    vi.useFakeTimers()
    let upstreamSignal: AbortSignal | null = null

    await expect(
      upstream.withUpstreamDeadline(undefined, 100, async (signal) => {
        upstreamSignal = signal
        return "ok"
      }),
    ).resolves.toBe("ok")

    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(upstreamSignal).not.toBeNull()
    expect(upstreamSignal!.aborted).toBe(false)
  })

  it("supports a deferred deadline for streaming uploads without timing the ingress body", async () => {
    vi.useFakeTimers()
    const create = (upstream as Record<string, unknown>).createUpstreamDeadline
    expect(typeof create).toBe("function")
    if (typeof create !== "function") return
    const deadline = (create as (
      signal: AbortSignal | undefined,
      timeoutMs: number,
      options: { startImmediately: boolean },
    ) => { signal: AbortSignal; start(): void; finish(): void; didTimeout(): boolean })(
      undefined,
      100,
      { startImmediately: false },
    )

    await vi.advanceTimersByTimeAsync(1_000)
    expect(deadline.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)

    deadline.start()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(100)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.didTimeout()).toBe(true)
    deadline.finish()
    expect(vi.getTimerCount()).toBe(0)
  })
})
