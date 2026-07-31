import { describe, expect, test, vi } from "vitest"
import { mediaCallerRequestFingerprintSha256 } from "@kokoro/site-client"

import {
  createMediaBrowserClient,
  createMediaCommandIdentity,
  createMediaCommandRecoveryStore,
  MediaCommandRecoveryCapacityError,
  MediaCommandRecoveryStorageError,
} from "../src/browser-client"

const at = "2026-07-31T00:00:00.000Z"
const pageInfo = { hasMore: false, nextCursor: null }
const safeFailure = { code: "input_rejected", retryClass: "never", safeMessage: "Rejected." }
const definition = {
  definitionKey: "image.text_to_image@v1",
  definitionRef: "image.text_to_image",
  definitionRevisionRef: "image.text_to_image@1",
  description: "Create an image",
  kind: "image_text_to_image",
  maximumCandidateCount: 4,
  modelOptionCatalogRevisionRef: "catalog@1",
  promptMaximumUtf8Bytes: 32768,
  publishedAt: at,
  supportedAspectRatios: ["square_1_1"],
  supportedOutputFormats: ["png"],
  title: "Image",
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } })
}

function activeOperation(operationRef = "operation-1") {
  return {
    operationRef,
    state: "active",
    candidates: [],
    costProjection: null,
    createdAt: at,
    definitionRef: "image.text_to_image",
    definitionRevisionRef: "image.text_to_image@1",
    modelOptionRevisionRef: "image.safe@1",
    ownerVersion: "1",
    progressBps: 100,
    updatedAt: at,
  }
}

function memoryStorage(values = new Map<string, string>()) {
  return {
    get length() { return values.size },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

const operationInput = {
  kind: "image_text_to_image" as const,
  definitionRevisionRef: "image.text_to_image@1",
  promptIntent: "A fox beneath the moon",
  aspectRatio: "square_1_1" as const,
  candidateCount: 1,
  modelOptionRevisionRef: "image.safe@1",
  outputFormat: "png" as const,
}

describe("Site media browser client", () => {
  test("calls only the exact same-origin media BFF paths and sends browser CSRF on controls", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return Promise.resolve(jsonResponse({ items: [], pageInfo }))
    })
    const client = createMediaBrowserClient({ fetch, csrfToken: "browser-csrf" })
    await client.listDefinitions({ limit: 20 })
    await client.listOperations({})

    expect(calls.map(({ url }) => url)).toEqual([
      "/api/media/definitions?limit=20",
      "/api/media/operations",
    ])

    const fingerprint = await mediaCallerRequestFingerprintSha256({ contractMajor: 1, ...operationInput })
    fetch.mockResolvedValueOnce(jsonResponse({
      receipt: {
        callerRequestFingerprint: fingerprint,
        commandId: "1".repeat(32),
        receiptKind: "submit_rejected",
        receiptVersion: "1",
        safeFailure,
        updatedAt: at,
      },
      operation: null,
    }, 202))
    await client.submit(operationInput, { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) })

    expect(fetch.mock.calls[2]).toEqual([
      "/api/media/operations",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-kokoro-browser-csrf": "browser-csrf" }) }),
    ])
    expect((fetch.mock.calls[2]?.[1] as RequestInit | undefined)?.body).not.toContain("projectRef")

    fetch.mockResolvedValueOnce(jsonResponse({ operation: activeOperation() }))
    const controller = new AbortController()
    await client.getOperation("operation-1", controller.signal)
    expect(fetch.mock.calls[3]).toEqual([
      "/api/media/operations/operation-1",
      expect.objectContaining({ method: "GET", signal: controller.signal }),
    ])
  })

  test("forwards cancellation to both read and control requests", async () => {
    const fingerprint = await mediaCallerRequestFingerprintSha256({ contractMajor: 1, ...operationInput })
    const fetch = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const path = String(input)
      if (path === "/api/media/quotes") return Promise.resolve(jsonResponse({ quote: {
        quoteRef: "quote-1",
        definitionRevisionRef: "image.text_to_image@1",
        modelOptionRevisionRef: "image.safe@1",
        estimate: { amount: "1", creditUnit: "credits" },
        expiresAt: "2026-08-01T00:00:00.000Z",
        nonBinding: true,
      } }))
      if (path === "/api/media/operations" && init?.method === "POST") return Promise.resolve(jsonResponse({
        receipt: {
          callerRequestFingerprint: fingerprint, commandId: "1".repeat(32), receiptKind: "submit_rejected",
          receiptVersion: "1", safeFailure, updatedAt: at,
        },
        operation: null,
      }, 202))
      if (path.endsWith("/cancel")) return Promise.resolve(jsonResponse({
        receipt: {
          commandId: "1".repeat(32), receiptKind: "cancel_rejected", receiptVersion: "1", safeFailure, updatedAt: at,
        },
        operation: null,
      }, 202))
      return Promise.resolve(jsonResponse({ items: [], pageInfo }))
    })
    const client = createMediaBrowserClient({ fetch, csrfToken: "browser-csrf" })
    const controller = new AbortController()
    const command = { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) }
    await client.listDefinitions({ limit: 20 }, controller.signal)
    await client.quote(operationInput, command, controller.signal)
    await client.submit(operationInput, command, controller.signal)
    await client.cancel(
      "operation-1",
      { expectedOwnerVersion: "1", reason: "owner requested" },
      command,
      controller.signal,
    )
    await client.listArtifacts({ limit: 20 }, controller.signal)
    await client.listArtifactVersions("artifact-1", { limit: 20 }, controller.signal)

    expect(fetch).toHaveBeenCalledTimes(6)
    for (const [, init] of fetch.mock.calls) expect(init).toEqual(expect.objectContaining({ signal: controller.signal }))
  })

  test("rejects malformed payloads and request/response identity conflicts at the BFF boundary", async () => {
    const fetch = vi.fn()
    const client = createMediaBrowserClient({ fetch, csrfToken: "browser-csrf" })
    const operationInput = {
      kind: "image_text_to_image" as const,
      definitionRevisionRef: "image.text_to_image@1",
      promptIntent: "A fox",
      aspectRatio: "square_1_1" as const,
      candidateCount: 1,
      modelOptionRevisionRef: "image.safe@1",
      outputFormat: "png" as const,
    }
    const command = { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) }

    fetch.mockResolvedValueOnce(jsonResponse({ items: [definition], pageInfo: { nextCursor: null } }))
    await expect(client.listDefinitions({})).rejects.toMatchObject({ status: 502, code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({ definition: { ...definition, definitionRef: "image.other" } }))
    await expect(client.getDefinition("image.text_to_image")).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({ definitionRevisionRef: "image.text_to_image@2", items: [], pageInfo }))
    await expect(client.listModelOptions("image.text_to_image", "image.text_to_image@1", {})).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({ operation: activeOperation("operation-other") }))
    await expect(client.getOperation("operation-1")).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({ quote: {
      quoteRef: "quote-1",
      definitionRevisionRef: "image.text_to_image@2",
      modelOptionRevisionRef: "image.safe@1",
      estimate: { amount: "1", creditUnit: "credits" },
      expiresAt: "2026-08-01T00:00:00.000Z",
      nonBinding: true,
    } }))
    await expect(client.quote(operationInput, command)).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({
      receipt: {
        callerRequestFingerprint: "f".repeat(64), commandId: "2".repeat(32), receiptKind: "submit_rejected",
        receiptVersion: "1", safeFailure, updatedAt: at,
      },
      operation: null,
    }, 202))
    await expect(client.submit(operationInput, command)).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({
      receipt: {
        callerRequestFingerprint: "0".repeat(64), commandId: command.commandId, receiptKind: "submit_rejected",
        receiptVersion: "1", safeFailure, updatedAt: at,
      },
      operation: null,
    }, 202))
    await expect(client.submit(operationInput, command)).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({
      receipt: {
        callerRequestFingerprint: "0".repeat(64), commandId: command.commandId, receiptKind: "submit_rejected",
        receiptVersion: "1", safeFailure, updatedAt: at,
      },
      operation: null,
    }))
    await expect(client.recoverCommand(command.commandId, {
      kind: "submit",
      callerRequestFingerprint: "f".repeat(64),
    })).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })
  })

  test("accepts only exact same-origin ready artifact content URLs correlated to owner refs", async () => {
    const artifact = {
      artifactRef: "artifact-1",
      availability: "ready",
      currentArtifactVersionRef: "artifact-v1",
      mediaClass: "image",
      title: "Ready",
      createdAt: at,
      updatedAt: at,
    }
    const version = {
      artifactRef: "artifact-1",
      artifactVersionRef: "artifact-v1",
      availability: "ready",
      createdAt: at,
      display: { format: "png", width: 32, height: 32, byteSize: "4" },
      mediaClass: "image",
      ownerVersion: "1",
      sourceArtifactVersionRefs: [],
      versionNumber: "1",
    }
    const exact = "/api/media/artifacts/artifact-1/versions/artifact-v1/content?purpose=preview&viewport=thumbnail"
    const fetch = vi.fn()
    const client = createMediaBrowserClient({ fetch, csrfToken: "browser-csrf" })
    fetch.mockResolvedValueOnce(jsonResponse({ items: [{ ...artifact, contentUrl: exact }], pageInfo }))
    await expect(client.listArtifacts({})).resolves.toMatchObject({ items: [{ contentUrl: exact }] })

    fetch.mockResolvedValueOnce(jsonResponse({ version: { ...version, contentUrl: "https://evil.example/object" } }))
    await expect(client.getArtifactVersion("artifact-1", "artifact-v1")).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })

    fetch.mockResolvedValueOnce(jsonResponse({ items: [{ ...version, artifactRef: "artifact-other", contentUrl: exact }], pageInfo }))
    await expect(client.listArtifactVersions("artifact-1", {})).rejects.toMatchObject({ code: "BFF_PROTOCOL_INVALID" })
  })

  test("persists only the exact command and caller identity needed for recovery", () => {
    const values = new Map<string, string>()
    const storage = memoryStorage(values)
    const store = createMediaCommandRecoveryStore({ storage, scope: "site:user:project", now: () => Date.parse("2026-07-31T00:00:01.000Z") })
    const command = { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) }
    const callerRequestFingerprint = "f".repeat(64)
    store.remember({ kind: "submit", command, callerRequestFingerprint, createdAt: "2026-07-31T00:00:00.000Z" })

    expect(store.list()).toEqual([{ kind: "submit", command, callerRequestFingerprint, createdAt: "2026-07-31T00:00:00.000Z" }])
    expect([...values.values()][0]).not.toMatch(/operation|artifact|ownerVersion/u)
    store.forget(command.commandId)
    expect(store.list()).toEqual([])
  })

  test("uses independent per-command keys so tabs cannot overwrite unresolved commands", () => {
    const values = new Map<string, string>()
    const storage = memoryStorage(values)
    const scope = "site:user:project"
    const now = Date.parse("2026-07-31T12:00:00.000Z")
    const command = { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) }
    const first = createMediaCommandRecoveryStore({ storage, scope, now: () => now })
    const second = createMediaCommandRecoveryStore({ storage, scope, now: () => now })
    first.remember({ kind: "submit", command, callerRequestFingerprint: "a".repeat(64), createdAt: "2026-07-31T11:00:00.000Z" })
    second.remember({
      kind: "cancel",
      command: { ...command, commandId: "3".repeat(32) },
      operationRef: "operation-3",
      createdAt: "2026-07-31T11:00:00.000Z",
    })

    expect(first.list()).toHaveLength(2)
    expect([...values.keys()]).toEqual(expect.arrayContaining([
      expect.stringContaining(command.commandId),
      expect.stringContaining("3".repeat(32)),
    ]))
    expect([...values.keys()].every((key) => key.startsWith(`kokoro.media.command.v2:${encodeURIComponent(scope)}:`))).toBe(true)
  })

  test("removes expired or malformed per-command recovery records independently", () => {
    const values = new Map<string, string>()
    const scope = "site:user:project"
    const prefix = `kokoro.media.command.v2:${encodeURIComponent(scope)}:`
    const now = Date.parse("2026-07-31T12:00:00.000Z")
    const expiredId = "1".repeat(32)
    values.set(`${prefix}${expiredId}`, JSON.stringify({
      kind: "submit",
      command: { commandId: expiredId, idempotencyKey: "i".repeat(24) },
      callerRequestFingerprint: "f".repeat(64),
      createdAt: "2026-07-30T11:59:59.999Z",
    }))
    values.set(`${prefix}${"2".repeat(32)}`, "not-json")

    const store = createMediaCommandRecoveryStore({ storage: memoryStorage(values), scope, now: () => now })
    expect(store.list()).toEqual([])
    expect(values.size).toBe(0)
  })

  test("fails closed at recovery capacity without evicting unresolved commands", () => {
    const values = new Map<string, string>()
    const store = createMediaCommandRecoveryStore({ storage: memoryStorage(values), scope: "site:user:project" })
    for (let index = 0; index < 20; index += 1) {
      store.remember({
        kind: "submit",
        command: { commandId: index.toString(16).padStart(32, "0"), idempotencyKey: "i".repeat(24) },
        callerRequestFingerprint: index.toString(16).padStart(64, "0"),
        createdAt: new Date(Date.now() - index).toISOString(),
      })
    }
    expect(() => store.remember({
      kind: "submit",
      command: { commandId: "f".repeat(32), idempotencyKey: "i".repeat(24) },
      callerRequestFingerprint: "f".repeat(64),
      createdAt: new Date().toISOString(),
    })).toThrow(MediaCommandRecoveryCapacityError)
    expect(store.list()).toHaveLength(20)
  })

  test("fails closed with a recoverable error when browser storage is denied", () => {
    const denied = () => { throw Object.assign(new Error("denied"), { name: "SecurityError" }) }
    const store = createMediaCommandRecoveryStore({
      storage: { get length() { return denied() }, key: denied, getItem: denied, setItem: denied, removeItem: denied },
      scope: "site:user:project",
    })

    expect(() => store.list()).toThrow(MediaCommandRecoveryStorageError)
    expect(() => store.remember({
      kind: "submit",
      command: { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) },
      callerRequestFingerprint: "f".repeat(64),
      createdAt: "2026-07-31T00:00:00.000Z",
    })).toThrowError(expect.objectContaining({ code: "MEDIA_RECOVERY_STORAGE_UNAVAILABLE" }))
  })

  test("creates independent lowercase command and idempotency identities", () => {
    let fill = 0
    const command = createMediaCommandIdentity((length) => new Uint8Array(length).fill(++fill))
    expect(command.commandId).toMatch(/^[0-9a-f]{32}$/u)
    expect(command.idempotencyKey).toMatch(/^[0-9a-f]{48}$/u)
    expect(command.commandId).not.toBe(command.idempotencyKey)
  })
})
