import { describe, expect, it } from "vitest"

import type { OpaqueAuthSession } from "@kokoro/bff-runtime"

import { createSiteAssetApi } from "../src/asset-api.js"

const auth: OpaqueAuthSession = {
  sessionRef: "identity-session-12345678",
  sessionCredential: "s".repeat(64),
  expiresAt: "2026-07-30T00:00:00.000Z",
}
const upload = {
  clientMediaType: "image/png", expectedSize: "1024", expectedVersion: "1", intentRef: "intent-12345678",
  projectRef: "server-only-project-12345678", purpose: "chat.attachment", retryAfter: null, retryClass: "never",
  safeDisplayName: "picture.png", safeReasonCode: null, sessionRef: "upload-session-12345678",
  stage: "ready", terminal: true, trustedGrant: {
    assetGrantRef: "grant-12345678", assetRef: "asset-12345678", assetVersionRef: "asset-version-12345678",
    detectedMediaType: "image/png", eligibilityEpoch: "1", projectRef: "server-only-project-12345678",
    purpose: "chat.attachment", size: "1024", state: "ready", subjectGeneration: "1",
  },
} as const

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`https://site.example/api/assets${path}`, {
    ...init,
    headers: {
      "sec-fetch-site": "same-origin",
      origin: "https://site.example",
      "content-type": "application/json",
      "x-kokoro-browser-csrf": "browser-csrf",
      ...init.headers,
    },
  })
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    publicOrigin: "https://site.example",
    verifyBrowserMutation: ({ operationId, token }: { operationId: string; token: string }) =>
      operationId === "asset.upload" && token === "browser-csrf",
    createAssetUploadIntent: async () => ({
      capability: { capabilityEpoch: "1", credential: "c".repeat(64), expiresAt: "2026-07-30T00:00:00.000Z",
        maximumPartBytes: "8388608", minimumPartBytes: "5242880", protocolRevision: "s3-multipart-v1",
        uploadEndpoint: "https://uploads.example" },
      receipt: {}, upload: { ...upload, stage: "uploading", terminal: false, trustedGrant: null },
    }),
    getAssetUploadStatus: async () => ({ upload }),
    completeAssetUpload: async () => ({ receipt: {}, upload: { ...upload, stage: "scan_waiting", terminal: false, trustedGrant: null } }),
    ...overrides,
  }
}

describe("Site Asset browser control plane", () => {
  it("returns only capability and provider-neutral upload state while deriving owner scope server-side", async () => {
    const calls: unknown[] = []
    const api = createSiteAssetApi({
      runtime: runtime({ createAssetUploadIntent: async (...args: unknown[]) => {
        calls.push(args)
        return runtime().createAssetUploadIntent()
      } }) as never,
      readAuthSession: () => auth,
    })
    const response = await api.handle(request("", { method: "POST", body: JSON.stringify({
      command: { commandId: "1".repeat(32), idempotencyKey: "2".repeat(48) },
      clientMediaType: "image/png", expectedChecksumSha256: "a".repeat(64), expectedSize: "1024",
      filename: "picture.png", purpose: "chat.attachment",
    }) }), [])

    expect(response.status).toBe(201)
    const body = await response.json()
    expect(body.capability).toEqual(expect.objectContaining({ uploadEndpoint: "https://uploads.example", credential: "c".repeat(64) }))
    expect(body.upload).toEqual(expect.objectContaining({ intentRef: "intent-12345678", stage: "uploading" }))
    expect(JSON.stringify(body)).not.toContain("server-only-project")
    expect(JSON.stringify(body)).not.toContain("bucket")
    expect(calls[0]).toEqual([auth, {
      clientMediaType: "image/png", expectedChecksumSha256: "a".repeat(64), expectedSize: "1024",
      filename: "picture.png", purpose: "chat.attachment",
    }, { commandId: "1".repeat(32), idempotencyKey: "2".repeat(48) }])
  })

  it("projects a ready owner state into the exact Session attachment reference", async () => {
    const api = createSiteAssetApi({ runtime: runtime() as never, readAuthSession: () => auth })
    const response = await api.handle(request("/intent-12345678", { method: "GET" }), ["intent-12345678"])
    expect(await response.json()).toEqual({ upload: expect.objectContaining({
      stage: "ready",
      attachment: {
        asset_ref: "asset-12345678",
        asset_version_ref: "asset-version-12345678",
        asset_grant_ref: "grant-12345678",
      },
    }) })
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("fails closed before auth or RPC for cross-site and invalid CSRF requests", async () => {
    let reads = 0
    const api = createSiteAssetApi({ runtime: runtime() as never, readAuthSession: () => { reads += 1; return auth } })
    const crossSite = await api.handle(request("/intent-12345678", {
      method: "GET", headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
    }), ["intent-12345678"])
    const csrf = await api.handle(request("", {
      method: "POST", headers: { "x-kokoro-browser-csrf": "wrong" }, body: "{}",
    }), [])
    expect([crossSite.status, csrf.status]).toEqual([403, 403])
    expect(reads).toBe(0)
  })

  it("cancels an oversized streamed control body before invoking Platform", async () => {
    let cancelled = false
    let invoked = false
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(40_000)) },
      cancel() { cancelled = true },
    })
    const api = createSiteAssetApi({
      runtime: runtime({ createAssetUploadIntent: async () => { invoked = true; throw new Error("must not run") } }) as never,
      readAuthSession: () => auth,
    })
    const response = await api.handle(request("", { method: "POST", body: stream, duplex: "half" } as RequestInit & { duplex: "half" }), [])
    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(invoked).toBe(false)
  })
})
