import { PassThrough } from "node:stream"
import type { IncomingHttpHeaders, IncomingMessage } from "node:http"

import { describe, expect, test, vi } from "vitest"

import { createNodeArtifactDeliveryTransport } from "../src/artifact-delivery-transport.js"

function upstream(statusCode: number, headers: IncomingHttpHeaders, rawHeaders: string[] = []) {
  const body = new PassThrough() as PassThrough & IncomingMessage
  Object.defineProperties(body, {
    statusCode: { value: statusCode },
    headers: { value: headers },
    rawHeaders: { value: rawHeaders },
  })
  return body
}

describe("Node artifact delivery transport", () => {
  test("maps server-only workload and capability credentials and preserves streaming backpressure", async () => {
    const response = upstream(206, {
      "content-type": "image/png",
      "content-range": "bytes 0-3/8",
      "content-length": "4",
    })
    let captured: Parameters<Parameters<typeof createNodeArtifactDeliveryTransport>[0]["open"]>[0] | undefined
    const transport = createNodeArtifactDeliveryTransport({
      binding: { workloadCredential: "workload-secret" },
      maximumTimeoutMs: 10_000,
      open(request) {
        captured = request
        return Promise.resolve(response)
      },
    })
    const signal = new AbortController().signal
    const delivered = await transport.redeem({
      method: "GET",
      path: "/v1/artifact-delivery-authorizations/authorization-1/content",
      headers: {
        "Kokoro-Contract-Version": "1",
        "X-Kokoro-Request-Deadline-Ms": "5000",
        Range: "bytes=0-3",
      },
      signal,
      security: { deliveryCapability: "d".repeat(32) },
    })

    expect(captured).toMatchObject({
      method: "GET",
      path: "/v1/artifact-delivery-authorizations/authorization-1/content",
      body: null,
      signal,
      timeoutMs: 5_000,
      headers: {
        accept: "application/octet-stream",
        "Kokoro-Contract-Version": "1",
        "X-Kokoro-Request-Deadline-Ms": "5000",
        Range: "bytes=0-3",
        "x-kokoro-workload-credential": "workload-secret",
        "x-kokoro-artifact-delivery-capability": "d".repeat(32),
      },
    })
    expect(delivered.status).toBe(206)
    expect(delivered.body).toBeInstanceOf(ReadableStream)
    expect(response.readableEnded).toBe(false)

    response.write(Uint8Array.of(1, 2, 3, 4))
    response.end()
    const reader = delivered.body.getReader()
    expect((await reader.read()).value).toEqual(Uint8Array.of(1, 2, 3, 4))
  })

  test("preserves a bodyless 416 with its unsatisfied-range metadata", async () => {
    const response = upstream(416, { "content-range": "bytes */8", "content-length": "0" })
    const transport = createNodeArtifactDeliveryTransport({
      binding: { workloadCredential: "workload-secret" },
      maximumTimeoutMs: 10_000,
      open: () => Promise.resolve(response),
    })
    const delivered = await transport.redeem({
      method: "GET",
      path: "/v1/artifact-delivery-authorizations/authorization-1/content",
      headers: {
        "Kokoro-Contract-Version": "1",
        "X-Kokoro-Request-Deadline-Ms": "5000",
        Range: "bytes=9-10",
      },
      signal: new AbortController().signal,
      security: { deliveryCapability: "d".repeat(32) },
    })

    expect(delivered.status).toBe(416)
    expect(delivered.headers.get("content-range")).toBe("bytes */8")
    response.end()
  })

  test("propagates abort after headers and enforces the caller deadline across the stream", async () => {
    vi.useFakeTimers()
    try {
      const abortResponse = upstream(200, { "content-type": "image/png" })
      const abortController = new AbortController()
      const transport = createNodeArtifactDeliveryTransport({
        binding: { workloadCredential: "workload-secret" },
        maximumTimeoutMs: 10_000,
        open: () => Promise.resolve(abortResponse),
      })
      await transport.redeem({
        method: "GET",
        path: "/v1/artifact-delivery-authorizations/authorization-1/content",
        headers: { "Kokoro-Contract-Version": "1", "X-Kokoro-Request-Deadline-Ms": "100" },
        signal: abortController.signal,
        security: { deliveryCapability: "d".repeat(32) },
      })
      abortController.abort("browser disconnected")
      expect(abortResponse.destroyed).toBe(true)

      const timeoutResponse = upstream(200, { "content-type": "image/png" })
      const timeoutTransport = createNodeArtifactDeliveryTransport({
        binding: { workloadCredential: "workload-secret" },
        maximumTimeoutMs: 10_000,
        open: () => Promise.resolve(timeoutResponse),
      })
      const pending = await timeoutTransport.redeem({
        method: "GET",
        path: "/v1/artifact-delivery-authorizations/authorization-2/content",
        headers: { "Kokoro-Contract-Version": "1", "X-Kokoro-Request-Deadline-Ms": "50" },
        signal: new AbortController().signal,
        security: { deliveryCapability: "d".repeat(32) },
      })
      await vi.advanceTimersByTimeAsync(51)
      expect(pending.body).toBeInstanceOf(ReadableStream)
      expect(timeoutResponse.destroyed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  test.each([
    "/v1/artifact-delivery-authorizations/%2F/content",
    "/v1/artifact-delivery-authorizations/%2e/content",
    "/v1/artifact-delivery-authorizations/%61uthorization-1/content",
    "/v1/artifact-delivery-authorizations/%zz/content",
  ])("rejects non-canonical authorization paths before dispatch: %s", async (path) => {
    const open = vi.fn()
    const transport = createNodeArtifactDeliveryTransport({
      binding: { workloadCredential: "workload-secret" },
      maximumTimeoutMs: 10_000,
      open,
    })
    await expect(transport.redeem({
      method: "GET",
      path,
      headers: { "Kokoro-Contract-Version": "1", "X-Kokoro-Request-Deadline-Ms": "5000" },
      signal: new AbortController().signal,
      security: { deliveryCapability: "d".repeat(32) },
    })).rejects.toMatchObject({ code: "UPSTREAM_PROTOCOL_INVALID" })
    expect(open).not.toHaveBeenCalled()
  })

  test("rejects an overlong Range before parsing or dispatch", async () => {
    const open = vi.fn()
    const transport = createNodeArtifactDeliveryTransport({
      binding: { workloadCredential: "workload-secret" },
      maximumTimeoutMs: 10_000,
      open,
    })
    await expect(transport.redeem({
      method: "GET",
      path: "/v1/artifact-delivery-authorizations/authorization-1/content",
      headers: {
        "Kokoro-Contract-Version": "1",
        "X-Kokoro-Request-Deadline-Ms": "5000",
        Range: `bytes=0-${"9".repeat(65)}`,
      },
      signal: new AbortController().signal,
      security: { deliveryCapability: "d".repeat(32) },
    })).rejects.toMatchObject({ code: "UPSTREAM_PROTOCOL_INVALID" })
    expect(open).not.toHaveBeenCalled()
  })

  test.each([
    "content-type", "content-length", "content-range", "etag", "last-modified",
    "content-disposition", "accept-ranges",
  ])("destroys and rejects duplicate delivery response header %s", async (header) => {
    const response = upstream(200, { [header]: ["first", "second"] }, [header, "first", header, "second"])
    const transport = createNodeArtifactDeliveryTransport({
      binding: { workloadCredential: "workload-secret" },
      maximumTimeoutMs: 10_000,
      open: () => Promise.resolve(response),
    })
    await expect(transport.redeem({
      method: "GET",
      path: "/v1/artifact-delivery-authorizations/authorization-1/content",
      headers: { "Kokoro-Contract-Version": "1", "X-Kokoro-Request-Deadline-Ms": "5000" },
      signal: new AbortController().signal,
      security: { deliveryCapability: "d".repeat(32) },
    })).rejects.toMatchObject({ code: "UPSTREAM_PROTOCOL_INVALID" })
    expect(response.destroyed).toBe(true)
  })

  test.each(["image/png, text/html", "image", "image/png; charset", "image/png\ntext/html"])(
    "destroys and rejects malformed content-type %s",
    async (contentType) => {
      const response = upstream(200, { "content-type": contentType })
      const transport = createNodeArtifactDeliveryTransport({
        binding: { workloadCredential: "workload-secret" },
        maximumTimeoutMs: 10_000,
        open: () => Promise.resolve(response),
      })
      await expect(transport.redeem({
        method: "GET",
        path: "/v1/artifact-delivery-authorizations/authorization-1/content",
        headers: { "Kokoro-Contract-Version": "1", "X-Kokoro-Request-Deadline-Ms": "5000" },
        signal: new AbortController().signal,
        security: { deliveryCapability: "d".repeat(32) },
      })).rejects.toMatchObject({ code: "UPSTREAM_PROTOCOL_INVALID" })
      expect(response.destroyed).toBe(true)
    },
  )
})
