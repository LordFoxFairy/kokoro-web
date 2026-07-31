import { describe, expect, test } from "vitest"

import { createPlatformPublicClient, PlatformPublicInputError, type PlatformPublicTransport } from "../src/platform-public-client.js"

describe("Platform media command headers", () => {
  test("carries caller cancellation and deadline to the registered transport", async () => {
    let captured: Parameters<PlatformPublicTransport["execute"]>[0] | undefined
    const sentinel = new Error("captured")
    const client = createPlatformPublicClient({
      transport: { execute(request) { captured = request; return Promise.reject(sentinel) } },
      csrfToken: () => "c".repeat(32),
    })
    const signal = new AbortController().signal

    await expect(client.execute({
      operationId: "listMediaOperations",
      data: { path: { projectRef: "project-1" }, query: {} },
      signal,
      deadlineMs: 30_000,
    })).rejects.toBe(sentinel)

    expect(captured).toEqual(expect.objectContaining({ signal, deadlineMs: 30_000 }))
  })

  test("rejects invalid transport deadlines before dispatch", async () => {
    const transport = { execute: () => Promise.reject(new Error("must not dispatch")) }
    const client = createPlatformPublicClient({ transport, csrfToken: () => "c".repeat(32) })
    await expect(client.execute({
      operationId: "listMediaOperations",
      data: { path: { projectRef: "project-1" }, query: {} },
      deadlineMs: 0,
    })).rejects.toBeInstanceOf(PlatformPublicInputError)
  })

  test("sends the generated caller request fingerprint only for media submit", async () => {
    let captured: Readonly<Record<string, string>> | undefined
    const sentinel = new Error("captured")
    const transport: PlatformPublicTransport = {
      execute(request) {
        captured = request.headers
        return Promise.reject(sentinel)
      },
    }
    const client = createPlatformPublicClient({ transport, csrfToken: () => "c".repeat(32) })
    const fingerprint = "a".repeat(64)

    await expect(client.execute({
      operationId: "submitMediaOperation",
      data: {
        path: { projectRef: "project-1" },
        body: {
          kind: "image_text_to_image",
          definitionRevisionRef: "image.text_to_image@1",
          promptIntent: "A fox beneath the moon",
          aspectRatio: "square_1_1",
          candidateCount: 1,
          modelOptionRevisionRef: "image.safe@1",
          outputFormat: "png",
        },
      },
      command: { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) },
      callerRequestFingerprint: fingerprint,
    })).rejects.toBe(sentinel)

    expect(captured?.["X-Kokoro-Caller-Request-Fingerprint"]).toBe(fingerprint)
  })

  test("rejects a caller request fingerprint for every other operation", async () => {
    const client = createPlatformPublicClient({
      transport: { execute: () => Promise.reject(new Error("must not dispatch")) },
      csrfToken: () => "c".repeat(32),
    })
    await expect(client.execute({
      operationId: "listMediaOperations",
      data: { path: { projectRef: "project-1" } },
      callerRequestFingerprint: "a".repeat(64),
    })).rejects.toBeInstanceOf(PlatformPublicInputError)
  })
})
