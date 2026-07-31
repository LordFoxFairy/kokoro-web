import { describe, expect, test, vi } from "vitest"

import {
  ArtifactDeliveryProtocolError,
  createArtifactDeliveryClient,
  type ArtifactDeliveryTransport,
} from "../src/artifact-delivery-client.js"

function stream(bytes = Uint8Array.of(1)): ReadableStream<Uint8Array> {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close() } })
}

describe("artifact delivery client", () => {
  test("keeps the capability in server transport security and returns the unread stream", async () => {
    const body = stream(new Uint8Array(16))
    let captured: Parameters<ArtifactDeliveryTransport["redeem"]>[0] | undefined
    const transport: ArtifactDeliveryTransport = {
      redeem(request) {
        captured = request
        return Promise.resolve({
          status: 206,
          headers: new Headers({
            "content-type": "image/png",
            "content-length": "16",
            "content-range": "bytes 0-15/32",
            "accept-ranges": "bytes",
            etag: '"owner-version-9"',
            "x-upstream-secret": "must-not-pass",
          }),
          body,
        })
      },
    }
    const signal = new AbortController().signal
    const response = await createArtifactDeliveryClient({ transport }).redeem({
      authorizationRef: "authorization-1",
      deliveryCapability: "c".repeat(32),
      deadlineMs: 5_000,
      signal,
      expectedByteSize: 32n,
      expectedMediaType: "image/png",
      range: { start: 0n, endInclusive: 15n },
    })

    expect(captured).toMatchObject({
      method: "GET",
      path: "/v1/artifact-delivery-authorizations/authorization-1/content",
      signal,
      headers: {
        "Kokoro-Contract-Version": "1",
        "X-Kokoro-Request-Deadline-Ms": "5000",
        Range: "bytes=0-15",
      },
      security: { deliveryCapability: "c".repeat(32) },
    })
    expect(response.body).not.toBe(body)
    expect(response.headers).toEqual({
      "accept-ranges": "bytes",
      "content-length": "16",
      "content-range": "bytes 0-15/32",
      "content-type": "image/png",
      etag: '"owner-version-9"',
    })
    expect((await response.body.getReader().read()).value).toEqual(new Uint8Array(16))
  })

  test("rejects redirect, duplicate, or malformed metadata and cancels the upstream body", async () => {
    for (const response of [
      { status: 302, headers: new Headers({ location: "https://storage.example/object" }), body: stream() },
      { status: 206, headers: new Headers({ "content-type": "image/png" }), body: stream() },
      { status: 206, headers: new Headers({ "content-type": "image/png", "content-range": "bytes 0-0/2, bytes 1-1/2" }), body: stream() },
      { status: 206, headers: new Headers({ "content-type": "image/png", "content-range": "bytes 0-0/*" }), body: stream() },
    ]) {
      const cancel = vi.spyOn(response.body, "cancel")
      const client = createArtifactDeliveryClient({ transport: { redeem: () => Promise.resolve(response) } })
      await expect(client.redeem({
        authorizationRef: "authorization-1",
        deliveryCapability: "c".repeat(32),
        deadlineMs: 5_000,
        signal: new AbortController().signal,
        expectedByteSize: 2n,
        expectedMediaType: "image/png",
        range: response.status === 206 ? { start: 0n, endInclusive: 0n } : undefined,
      })).rejects.toBeInstanceOf(ArtifactDeliveryProtocolError)
      expect(cancel).toHaveBeenCalledOnce()
    }
  })

  test("delegates multi-range and over-eight-MiB rejection to the generated call validator", async () => {
    const client = createArtifactDeliveryClient({
      transport: { redeem: () => Promise.reject(new Error("must not dispatch")) },
    })
    await expect(client.redeem({
      authorizationRef: "authorization-1",
      deliveryCapability: "c".repeat(32),
      deadlineMs: 5_000,
      signal: new AbortController().signal,
      expectedByteSize: 8_388_609n,
      expectedMediaType: "image/png",
      range: { start: 0n, endInclusive: 8_388_608n },
    })).rejects.toMatchObject({ code: "ARTIFACT_DELIVERY_RANGE_INVALID" })
  })

  test.each([
    ["early EOF", Uint8Array.of(1), 2n],
    ["owner-bound overflow", Uint8Array.of(1, 2, 3), 2n],
  ] as const)("errors the downstream stream on %s without buffering", async (_name, bytes, expectedByteSize) => {
    const client = createArtifactDeliveryClient({ transport: { redeem: () => Promise.resolve({
      status: 200,
      headers: new Headers({ "content-type": "image/png" }),
      body: stream(bytes),
    }) } })
    const response = await client.redeem({
      authorizationRef: "authorization-1",
      deliveryCapability: "c".repeat(32),
      deadlineMs: 5_000,
      signal: new AbortController().signal,
      expectedByteSize,
      expectedMediaType: "image/png",
    })
    const reader = response.body.getReader()
    await expect((async () => {
      for (;;) {
        const next = await reader.read()
        if (next.done) return
      }
    })()).rejects.toBeInstanceOf(ArtifactDeliveryProtocolError)
  })

  test("rejects a media type that conflicts with the exact owner version", async () => {
    for (const contentType of ["text/html", "image/png; charset=binary"]) {
      const body = stream(Uint8Array.of(1, 2))
      const cancel = vi.spyOn(body, "cancel")
      const client = createArtifactDeliveryClient({ transport: { redeem: () => Promise.resolve({
        status: 200,
        headers: new Headers({ "content-type": contentType, "content-length": "2" }),
        body,
      }) } })
      await expect(client.redeem({
        authorizationRef: "authorization-1",
        deliveryCapability: "c".repeat(32),
        deadlineMs: 5_000,
        signal: new AbortController().signal,
        expectedByteSize: 2n,
        expectedMediaType: "image/png",
      })).rejects.toBeInstanceOf(ArtifactDeliveryProtocolError)
      expect(cancel).toHaveBeenCalledOnce()
    }
  })
})
