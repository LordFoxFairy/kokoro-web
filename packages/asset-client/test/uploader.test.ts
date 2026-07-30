import { describe, expect, it, vi } from "vitest"

import { createAssetUploader, createLocalAssetRecoveryStore, type AssetRecoveryRecord, type AssetRecoveryStore } from "../src/index.js"

const instant = "2026-07-30T00:00:00.000Z"
const uploadRef = "upload-reference-12345678"

function memoryStore() {
  const values = new Map<string, AssetRecoveryRecord>()
  const store: AssetRecoveryStore = {
    get: (key) => values.get(key) ?? null,
    put: (record) => { values.set(record.fingerprint, record) },
    delete: (key) => { values.delete(key) },
  }
  return { store, values }
}

function owner(stage: "uploading" | "scan_waiting" | "ready") {
  return {
    intentRef: "intent-12345678", sessionRef: "upload-session-12345678", expectedVersion: "1",
    stage, terminal: stage === "ready", retryClass: "never", retryAfter: null, safeReasonCode: null,
    attachment: stage === "ready" ? {
      asset_ref: "asset-12345678", asset_version_ref: "asset-version-12345678", asset_grant_ref: "grant-12345678",
    } : null,
  }
}

function receipt(operation: "initiate" | "put_part" | "complete") {
  return { operation, receiptRef: `receipt-${operation}-12345678`, receivedAt: instant, state: "succeeded", updatedAt: instant }
}

describe("capability-scoped Asset uploader", () => {
  it("bounds concurrent hashing and authorization work for a multi-file composer selection", async () => {
    const { store } = memoryStore()
    let releaseFirst!: () => void
    const firstResponse = new Promise<void>((resolve) => { releaseFirst = resolve })
    let requests = 0
    const fetcher: typeof fetch = async () => {
      requests += 1
      if (requests === 1) await firstResponse
      return Response.json({
        capability: { credential: "c".repeat(64), expiresAt: instant, minimumPartBytes: "1", maximumPartBytes: "16",
          protocolRevision: "s3-multipart-v1", uploadEndpoint: "https://uploads.example" },
        upload: owner("ready"),
      }, { status: 201 })
    }
    const progress: string[] = []
    const uploader = createAssetUploader({
      csrfToken: "browser-csrf",
      store,
      fetch: fetcher,
      maximumConcurrentUploads: 1,
    })

    const first = uploader.upload(new File(["one"], "one.txt", { type: "text/plain" }), {
      onProgress: ({ phase }) => progress.push(`one:${phase}`),
    })
    const second = uploader.upload(new File(["two"], "two.txt", { type: "text/plain" }), {
      onProgress: ({ phase }) => progress.push(`two:${phase}`),
    })
    await vi.waitFor(() => expect(progress).toContain("one:authorizing"))
    expect(progress).not.toContain("two:hashing")

    releaseFirst()
    await Promise.all([first, second])
    expect(progress).toContain("two:hashing")
  })

  it("prunes recovery identities from a previous account scope without touching unrelated storage", () => {
    const values = new Map<string, string>([
      ["kokoro.asset-upload.v1.old-project.fingerprint", "{}"],
      ["application.preference", "keep"],
    ])
    const storage = {
      get length() { return values.size },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => { values.delete(key) },
      setItem: (key: string, value: string) => { values.set(key, value) },
    } satisfies Storage
    createLocalAssetRecoveryStore({ storage, scope: "new-project", pruneOtherScopes: true })
    expect(values.has("kokoro.asset-upload.v1.old-project.fingerprint")).toBe(false)
    expect(values.get("application.preference")).toBe("keep")
  })

  it("persists identities before effects, reconciles an ambiguous part, and returns only a trusted attachment ref", async () => {
    const { store, values } = memoryStore()
    const ownerBodies: string[] = []
    let partAttempts = 0
    let partChecksum = ""
    let partSize = ""
    const fetcher: typeof fetch = async (request, init) => {
      const url = String(request)
      if (url === "/api/assets" && init?.method === "POST") {
        ownerBodies.push(String(init.body))
        if (ownerBodies.length === 1) throw new TypeError("ambiguous owner response")
        return Response.json({
          capability: { credential: "c".repeat(64), expiresAt: instant, minimumPartBytes: "1", maximumPartBytes: "16",
            protocolRevision: "s3-multipart-v1", uploadEndpoint: "https://uploads.example" },
          upload: owner("uploading"),
        }, { status: 201 })
      }
      if (url === "https://uploads.example/v1/multipart-uploads" && init?.method === "POST") {
        return Response.json({ receipt: receipt("initiate"), upload: {
          expectedSize: "4", expectedVersion: "1", expiresAt: instant, partSize: "4", parts: [],
          protocolRevision: "s3-multipart-v1", retryAfter: null, retryClass: "never", safeReasonCode: null,
          state: "uploading", uploadRef,
        } })
      }
      if (url.endsWith("/parts/1") && init?.method === "PUT") {
        partAttempts += 1
        const headers = new Headers(init.headers)
        partChecksum = headers.get("x-kokoro-content-sha256") ?? ""
        partSize = headers.get("x-kokoro-content-length") ?? ""
        throw new TypeError("connection reset after commit")
      }
      if (url === `https://uploads.example/v1/multipart-uploads/${uploadRef}` && init?.method === "GET") {
        return Response.json({ receipt: null, upload: {
          expectedSize: "4", expectedVersion: "2", expiresAt: instant, partSize: "4",
          parts: [{ checksumSha256: partChecksum, partNumber: 1, partReceipt: "part-receipt-12345678", size: partSize }],
          protocolRevision: "s3-multipart-v1", retryAfter: null, retryClass: "never", safeReasonCode: null,
          state: "uploading", uploadRef,
        } })
      }
      if (url === `https://uploads.example/v1/multipart-uploads/${uploadRef}:complete` && init?.method === "POST") {
        return Response.json({ receipt: receipt("complete"), upload: {
          expectedSize: "4", expectedVersion: "3", expiresAt: instant, partSize: "4",
          parts: [{ checksumSha256: partChecksum, partNumber: 1, partReceipt: "part-receipt-12345678", size: partSize }],
          protocolRevision: "s3-multipart-v1", retryAfter: null, retryClass: "never", safeReasonCode: null,
          state: "uploaded", uploadRef,
        } })
      }
      if (url === "/api/assets/intent-12345678/complete" && init?.method === "POST") {
        return Response.json({ upload: owner("scan_waiting") }, { status: 202 })
      }
      if (url === "/api/assets/intent-12345678" && init?.method === "GET") {
        return Response.json({ upload: owner("ready") })
      }
      throw new Error(`unexpected request: ${init?.method ?? "GET"} ${url}`)
    }
    const progress: string[] = []
    const uploader = createAssetUploader({ csrfToken: "browser-csrf", store, fetch: fetcher,
      poll: { attempts: 2, wait: async () => undefined } })
    const attachment = await uploader.upload(new File([new TextEncoder().encode("data")], "picture.png", { type: "image/png" }), {
      onProgress: ({ phase }) => progress.push(phase),
    })

    expect(attachment).toEqual({
      asset_ref: "asset-12345678", asset_version_ref: "asset-version-12345678", asset_grant_ref: "grant-12345678",
    })
    expect(ownerBodies).toHaveLength(2)
    expect(ownerBodies[0]).toBe(ownerBodies[1])
    expect(partAttempts).toBe(1)
    expect(progress).toEqual(["hashing", "authorizing", "uploading", "uploading", "verifying", "processing", "ready"])
    expect(values.size).toBe(0)
    expect(ownerBodies.join(" ")).not.toContain("project")
  })

  it("rejects oversized files before hashing, storage, or network effects", async () => {
    const { store, values } = memoryStore()
    let fetched = false
    const uploader = createAssetUploader({ csrfToken: "browser-csrf", store, maximumBytes: 3,
      fetch: async () => { fetched = true; throw new Error("must not run") } })
    await expect(uploader.upload(new File(["data"], "picture.png", { type: "image/png" })))
      .rejects.toMatchObject({ code: "FILE_TOO_LARGE" })
    expect(fetched).toBe(false)
    expect(values.size).toBe(0)
  })
})
