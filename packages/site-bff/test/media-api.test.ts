import { describe, expect, test, vi } from "vitest"

import type { SiteBffRuntime, SiteMediaAuthority } from "../src/index.js"
import { createSiteMediaApi } from "../src/media-api.js"

const origin = "https://site.example"
const auth = {} as never

function request(path: string, init?: RequestInit): Request {
  const headers = new Headers(init?.headers)
  headers.set("sec-fetch-site", "same-origin")
  return new Request(`${origin}/api/media${path}`, { ...init, headers })
}

function runtime(authority: SiteMediaAuthority): SiteBffRuntime {
  return {
    publicOrigin: origin,
    verifyBrowserMutation: () => true,
    media: () => Promise.resolve(authority),
  } as unknown as SiteBffRuntime
}

function authority(overrides: Partial<SiteMediaAuthority> = {}): SiteMediaAuthority {
  return {
    listDefinitions: () => Promise.resolve({ items: [], pageInfo: { nextCursor: null } }),
    getDefinition: () => Promise.reject(new Error("unused")),
    listModelOptions: () => Promise.reject(new Error("unused")),
    quote: () => Promise.reject(new Error("unused")),
    listOperations: () => Promise.resolve({ items: [], pageInfo: { nextCursor: null } }),
    submit: () => Promise.reject(new Error("unused")),
    getOperation: () => Promise.reject(new Error("unused")),
    cancel: () => Promise.reject(new Error("unused")),
    recoverCommand: () => Promise.reject(new Error("unused")),
    listArtifacts: () => Promise.resolve({ items: [], pageInfo: { nextCursor: null } }),
    getArtifact: () => Promise.reject(new Error("unused")),
    listArtifactVersions: () => Promise.reject(new Error("unused")),
    getArtifactVersion: () => Promise.reject(new Error("unused")),
    artifactContent: () => Promise.reject(new Error("unused")),
    ...overrides,
  }
}

describe("Site media browser API", () => {
  test("routes definition reads without accepting a browser project identity", async () => {
    const listDefinitions = vi.fn(() => Promise.resolve({
      items: [{
        definitionKey: "image.text_to_image@v1",
        definitionRef: "image.text_to_image",
        definitionRevisionRef: "image.text_to_image@1",
        description: "Create an image",
        kind: "image_text_to_image",
        maximumCandidateCount: 4,
        modelOptionCatalogRevisionRef: "image-catalog@1",
        promptMaximumUtf8Bytes: 32768,
        publishedAt: "2026-07-31T00:00:00.000Z",
        supportedAspectRatios: ["square_1_1"],
        supportedOutputFormats: ["png"],
        title: "Image",
      }],
      pageInfo: { nextCursor: null },
    }))
    const api = createSiteMediaApi({ runtime: runtime(authority({ listDefinitions })), readAuthSession: () => auth })
    const response = await api.handle(request("/definitions?limit=20&projectRef=browser-project"), ["definitions"])

    expect(response.status).toBe(400)
    expect(listDefinitions).not.toHaveBeenCalled()

    const accepted = await api.handle(request("/definitions?limit=20"), ["definitions"])
    expect(accepted.status).toBe(200)
    expect(listDefinitions).toHaveBeenCalledWith(
      { limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal), deadlineMs: 30_000 }),
    )
  })

  test("accepts the generated one-character definition reference boundary", async () => {
    const getDefinition = vi.fn(() => Promise.resolve({ definition: {} as never }))
    const api = createSiteMediaApi({ runtime: runtime(authority({ getDefinition })), readAuthSession: () => auth })
    const definitionRequest = request("/definitions/x")
    const response = await api.handle(definitionRequest, ["definitions", "x"])

    expect(response.status).toBe(200)
    expect(getDefinition).toHaveBeenCalledWith("x", expect.objectContaining({
      signal: definitionRequest.signal,
      deadlineMs: 30_000,
    }))
  })

  test("routes submit with command identity while leaving canonical fingerprinting server-side", async () => {
    const submit = vi.fn(() => Promise.resolve({ receipt: { receiptKind: "submit_rejected" }, operation: null }))
    const api = createSiteMediaApi({ runtime: runtime(authority({ submit })), readAuthSession: () => auth })
    const response = await api.handle(request("/operations", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-kokoro-browser-csrf": "browser-csrf",
      },
      body: JSON.stringify({
        command: { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) },
        input: {
          kind: "image_text_to_image",
          definitionRevisionRef: "image.text_to_image@1",
          promptIntent: "A fox beneath the moon",
          aspectRatio: "square_1_1",
          candidateCount: 1,
          modelOptionRevisionRef: "image.safe@1",
          outputFormat: "png",
        },
      }),
    }), ["operations"])

    expect(response.status).toBe(202)
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ promptIntent: "A fox beneath the moon" }),
      { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) },
      expect.objectContaining({ signal: expect.any(AbortSignal), deadlineMs: 30_000 }),
    )
  })

  test("enforces the prompt contract in UTF-8 bytes and maps semantic overflow to 400", async () => {
    const submit = vi.fn(() => Promise.resolve({ receipt: { receiptKind: "submit_rejected" }, operation: null }))
    const api = createSiteMediaApi({ runtime: runtime(authority({ submit })), readAuthSession: () => auth })
    const submitPrompt = (promptIntent: string) => api.handle(request("/operations", {
      method: "POST",
      headers: { origin, "content-type": "application/json", "x-kokoro-browser-csrf": "browser-csrf" },
      body: JSON.stringify({
        command: { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) },
        input: {
          kind: "image_text_to_image",
          definitionRevisionRef: "image.text_to_image@1",
          promptIntent,
          aspectRatio: "square_1_1",
          candidateCount: 1,
          modelOptionRevisionRef: "image.safe@1",
          outputFormat: "png",
        },
      }),
    }), ["operations"])

    expect((await submitPrompt("🦊".repeat(8_192))).status).toBe(202)
    const rejected = await submitPrompt("🦊".repeat(8_193))
    expect(rejected.status).toBe(400)
    await expect(rejected.json()).resolves.toMatchObject({ error: { code: "REQUEST_INVALID" } })
    expect(submit).toHaveBeenCalledTimes(1)

    const invalidUnicode = await submitPrompt("bad\ud800text")
    expect(invalidUnicode.status).toBe(400)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("adds same-origin content URLs only to ready artifact owner projections", async () => {
    const listArtifacts = () => Promise.resolve({
      items: [
        { artifactRef: "ready-artifact", availability: "ready", currentArtifactVersionRef: "ready-v1", mediaClass: "image", title: "Ready", createdAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:01:00.000Z" },
        { artifactRef: "pending-artifact", availability: "processing", currentArtifactVersionRef: "pending-v1", mediaClass: "image", title: "Pending", createdAt: "2026-07-31T00:00:00.000Z", updatedAt: "2026-07-31T00:01:00.000Z" },
      ],
      pageInfo: { nextCursor: null },
    })
    const api = createSiteMediaApi({ runtime: runtime(authority({ listArtifacts })), readAuthSession: () => auth })
    const response = await api.handle(request("/artifacts"), ["artifacts"])
    const payload = await response.json() as { items: Array<Record<string, unknown>> }

    expect(payload.items[0]?.contentUrl).toBe("/api/media/artifacts/ready-artifact/versions/ready-v1/content?purpose=preview&viewport=thumbnail")
    expect(payload.items[1]).not.toHaveProperty("contentUrl")
  })

  test("forwards one exact byte range and rejects ambiguous delivery query parameters", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Uint8Array.of(1, 2)); controller.close() },
    })
    const artifactContent = vi.fn(() => Promise.resolve({
      status: 206 as const,
      headers: { "content-type": "image/png", "content-range": "bytes 0-1/4" } as const,
      body,
    }))
    const api = createSiteMediaApi({ runtime: runtime(authority({ artifactContent })), readAuthSession: () => auth })
    const rangedRequest = request("/artifacts/artifact-1/versions/artifact-v1/content?purpose=preview&viewport=thumbnail", {
      headers: { range: "bytes=0-1" },
    })
    const response = await api.handle(rangedRequest, ["artifacts", "artifact-1", "versions", "artifact-v1", "content"])

    expect(response.status).toBe(206)
    expect(response.headers.get("content-range")).toBe("bytes 0-1/4")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(artifactContent).toHaveBeenCalledWith(
      "artifact-1",
      "artifact-v1",
      { purpose: "preview", viewportClass: "thumbnail" },
      expect.objectContaining({ signal: rangedRequest.signal, deadlineMs: 30_000, range: { start: 0n, endInclusive: 1n } }),
    )

    const ambiguous = await api.handle(
      request("/artifacts/artifact-1/versions/artifact-v1/content?purpose=preview&viewport=thumbnail&viewport=full"),
      ["artifacts", "artifact-1", "versions", "artifact-v1", "content"],
    )
    expect(ambiguous.status).toBe(400)
    expect(artifactContent).toHaveBeenCalledTimes(1)

    const oversizedRange = await api.handle(
      request("/artifacts/artifact-1/versions/artifact-v1/content?purpose=download", {
        headers: { range: `bytes=0-${"9".repeat(65)}` },
      }),
      ["artifacts", "artifact-1", "versions", "artifact-v1", "content"],
    )
    expect(oversizedRange.status).toBe(416)
    expect(artifactContent).toHaveBeenCalledTimes(1)
  })

  test("passes through a validated unsatisfied range without replacing its owner size", async () => {
    const artifactContent = vi.fn(() => Promise.resolve({
      status: 416 as const,
      headers: { "content-range": "bytes */4", "accept-ranges": "bytes" } as const,
      body: null,
    }))
    const api = createSiteMediaApi({ runtime: runtime(authority({ artifactContent })), readAuthSession: () => auth })
    const response = await api.handle(request(
      "/artifacts/artifact-1/versions/artifact-v1/content?purpose=preview&viewport=thumbnail",
      { headers: { range: "bytes=9-10" } },
    ), ["artifacts", "artifact-1", "versions", "artifact-v1", "content"])

    expect(response.status).toBe(416)
    expect(response.headers.get("content-range")).toBe("bytes */4")
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    expect(await response.text()).toBe("")
  })
})
