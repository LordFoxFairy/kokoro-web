import { describe, expect, it } from "vitest"

import {
  acquireHubUploadLease,
  prepareCountedRequestBody,
  readBoundedRequestBody,
} from "@/lib/server/http-boundary"

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}): Request {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk === undefined) controller.close()
      else controller.enqueue(chunk)
    },
  })
  return new Request("http://localhost/upload", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" })
}

describe("HTTP body boundary", () => {
  it("accepts an exact-cap body and preserves Unicode plus binary bytes", async () => {
    const unicode = new TextEncoder().encode("你好")
    const binary = new Uint8Array([0, 255])
    const expected = new Uint8Array([...unicode, ...binary])
    const result = await readBoundedRequestBody(
      streamedRequest([unicode, binary], { "content-length": String(expected.byteLength) }),
      expected.byteLength,
    )

    expect(result.ok).toBe(true)
    expect(result.ok ? [...new Uint8Array(result.body!)] : []).toEqual([...expected])
  })

  it("accepts an empty body without allocating a buffer", async () => {
    const result = await readBoundedRequestBody(new Request("http://localhost/empty", { method: "POST" }), 8)
    expect(result).toEqual({ ok: true, body: undefined })
  })

  it("rejects an underdeclared chunked body by actual bytes", async () => {
    const result = await readBoundedRequestBody(
      streamedRequest([new Uint8Array(4), new Uint8Array(1)], { "content-length": "4" }),
      4,
    )
    expect(result).toEqual({ ok: false, reason: "too_large" })
  })

  it("normalizes a request stream read error", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("read failed"))
      },
    })
    const request = new Request("http://localhost/error", {
      method: "POST",
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
    expect(await readBoundedRequestBody(request, 8)).toEqual({ ok: false, reason: "invalid" })
  })

  it("aborts a counted upload stream when actual bytes exceed its cap", async () => {
    const prepared = await prepareCountedRequestBody(streamedRequest([new Uint8Array(4), new Uint8Array(1)]), 4)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return

    await expect(new Response(prepared.body).arrayBuffer()).rejects.toBeInstanceOf(Error)
    expect(await prepared.completion).toEqual({ ok: false, reason: "too_large" })
    expect(prepared.signal.aborted).toBe(true)
  })

  it("does not let two underdeclared uploads exceed the aggregate reservation", () => {
    const first = acquireHubUploadLease(new Headers({ "content-length": "1" }))
    const second = acquireHubUploadLease(new Headers({ "content-length": "1" }))
    if (first.ok) first.lease.release()
    if (second.ok) second.lease.release()

    expect(first.ok).toBe(true)
    expect(second).toEqual({
      ok: false,
      status: 503,
      error: "hub_upload_capacity_unavailable",
      retryAfter: 2,
    })

    const afterRelease = acquireHubUploadLease(new Headers({ "content-length": "1" }))
    expect(afterRelease.ok).toBe(true)
    if (afterRelease.ok) {
      afterRelease.lease.release()
      afterRelease.lease.release()
    }
  })
})
