import { describe, expect, test, vi } from "vitest"

import type { MemoryCommandResponse, MemorySettings } from "@kokoro/site-client"
import { PlatformPublicError } from "@kokoro/site-client/server"

import {
  createSiteMemoryApi,
  type SiteMemoryApiRuntime,
  type SiteMemoryAuthority,
} from "../src/memory-api.js"

const origin = "https://site.example"
const auth = Object.freeze({}) as never
const command = Object.freeze({ commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) })

const settings: MemorySettings = Object.freeze({
  automaticLearning: Object.freeze({
    availability: "unavailable_until_memory_m3",
    effective: false,
    policyReason: null,
    requested: false,
  }),
  observedAt: "2026-07-31T00:00:00.000Z",
  pastChatReference: Object.freeze({
    availability: "unavailable_until_session_m1a",
    effective: false,
    policyReason: null,
    requested: false,
  }),
  revision: "1",
  savedMemoryUse: Object.freeze({
    availability: "available",
    effective: true,
    policyReason: null,
    requested: true,
  }),
})

function commandResponse(commandId = command.commandId): MemoryCommandResponse {
  return {
    command: {
      commandId,
      commandKind: "rememberMemoryEntry",
      receiptRef: "receipt-1",
      receivedAt: "2026-07-31T00:00:00.000Z",
      updatedAt: "2026-07-31T00:00:00.000Z",
    },
    retryAfter: "2026-07-31T00:00:01.000Z",
    state: "accepted",
  }
}

function browserRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers)
  headers.set("sec-fetch-site", "same-origin")
  return new Request(`${origin}/api/memory${path}`, { ...init, headers })
}

function mutationRequest(path: string, method: "PATCH" | "POST", input: unknown): Request {
  return browserRequest(path, {
    method,
    headers: {
      origin,
      "content-type": "application/json",
      "x-kokoro-browser-csrf": "browser-csrf",
    },
    body: JSON.stringify({ command, input }),
  })
}

function authority(overrides: Partial<SiteMemoryAuthority> = {}): SiteMemoryAuthority {
  const rejected = () => Promise.reject(new Error("unused"))
  return {
    getSettings: () => Promise.resolve(settings),
    updateSettings: rejected,
    listEntries: () => Promise.resolve({ items: [], pageInfo: { nextCursor: null } }),
    remember: rejected,
    getEntry: rejected,
    listHistory: rejected,
    restore: rejected,
    correct: rejected,
    prioritize: rejected,
    deprioritize: rejected,
    forget: rejected,
    reset: rejected,
    requestExport: rejected,
    getExport: rejected,
    requestImport: rejected,
    getImport: rejected,
    recoverCommand: rejected,
    ...overrides,
  }
}

function runtime(memory: SiteMemoryAuthority, overrides: Partial<SiteMemoryApiRuntime> = {}): SiteMemoryApiRuntime {
  return {
    publicOrigin: origin,
    verifyBrowserMutation: ({ operationId, token }) =>
      operationId === "memory.control" && token === "browser-csrf",
    memory: () => Promise.resolve(memory),
    ...overrides,
  }
}

function api(memory: SiteMemoryAuthority, overrides: Partial<SiteMemoryApiRuntime> = {}) {
  return createSiteMemoryApi({
    runtime: runtime(memory, overrides),
    readAuthSession: () => auth,
  })
}

function expiringApi(memory: SiteMemoryAuthority) {
  let reads = 0
  return createSiteMemoryApi({
    runtime: runtime(memory),
    readAuthSession: () => auth,
    monotonicNow: () => reads++ === 0 ? 0 : 29_999,
  })
}

describe("Site Memory browser API", () => {
  test("routes the complete closed Memory operation set and no arbitrary method or path", async () => {
    const calls = {
      getSettings: vi.fn(() => Promise.resolve(settings)),
      updateSettings: vi.fn(() => Promise.resolve(commandResponse())),
      listEntries: vi.fn(() => Promise.resolve({ items: [], pageInfo: { nextCursor: null } })),
      remember: vi.fn(() => Promise.resolve(commandResponse())),
      getEntry: vi.fn(() => Promise.resolve({ entry: { entryRef: "entry-1", purgeReceiptRef: "purge-1", purgedAt: "2026-07-31T00:00:00.000Z", state: "purged" as const } })),
      listHistory: vi.fn(() => Promise.resolve({ entryRef: "entry-1", items: [], pageInfo: { nextCursor: null } })),
      restore: vi.fn(() => Promise.resolve(commandResponse())),
      correct: vi.fn(() => Promise.resolve(commandResponse())),
      prioritize: vi.fn(() => Promise.resolve(commandResponse())),
      deprioritize: vi.fn(() => Promise.resolve(commandResponse())),
      forget: vi.fn(() => Promise.resolve(commandResponse())),
      reset: vi.fn(() => Promise.resolve(commandResponse())),
      requestExport: vi.fn(() => Promise.resolve(commandResponse())),
      getExport: vi.fn(() => Promise.resolve({ export: { artifactDownloadRequest: null, expiresAt: null, exportRef: "export-1", failureCode: null, format: "kokoro_memory_export_v1" as const, requestedAt: "2026-07-31T00:00:00.000Z", state: "queued" as const, updatedAt: "2026-07-31T00:00:00.000Z" } })),
      requestImport: vi.fn(() => Promise.resolve(commandResponse())),
      getImport: vi.fn(() => Promise.resolve({ import: { acceptedEntryCount: 0, assetRef: "asset-1", assetVersionRef: "asset-version-1", format: "kokoro_memory_export_v1" as const, importRef: "import-1", rejectedEntryCount: 0, requestedAt: "2026-07-31T00:00:00.000Z", safeStatusCode: "awaiting_review" as const, state: "quarantined" as const, updatedAt: "2026-07-31T00:00:00.000Z" } })),
      recoverCommand: vi.fn(() => Promise.resolve(commandResponse())),
    }
    const memory = authority(calls)
    const resolveMemory = vi.fn(() => Promise.resolve(memory))
    const surface = api(memory, { memory: resolveMemory })
    const cases: ReadonlyArray<readonly [Request, readonly string[]]> = [
      [browserRequest("/settings"), ["settings"]],
      [mutationRequest("/settings", "PATCH", { expectedRevision: "1", savedMemoryUseRequested: false }), ["settings"]],
      [browserRequest("/entries?category=profile&source=explicit&limit=20"), ["entries"]],
      [mutationRequest("/entries", "POST", { category: "profile", content: "Remember me", validFrom: null, validTo: null }), ["entries"]],
      [browserRequest("/entries/entry-1"), ["entries", "entry-1"]],
      [browserRequest("/entries/entry-1/history?limit=20"), ["entries", "entry-1", "history"]],
      [mutationRequest("/entries/entry-1/history/revision-1/restore", "POST", { expectedRevision: 1 }), ["entries", "entry-1", "history", "revision-1", "restore"]],
      [mutationRequest("/entries/entry-1/correct", "POST", { content: "Corrected", expectedRevision: 1, validFrom: null, validTo: null }), ["entries", "entry-1", "correct"]],
      [mutationRequest("/entries/entry-1/prioritize", "POST", { expectedEntryVersion: "1" }), ["entries", "entry-1", "prioritize"]],
      [mutationRequest("/entries/entry-1/deprioritize", "POST", { expectedEntryVersion: "1" }), ["entries", "entry-1", "deprioritize"]],
      [mutationRequest("/entries/entry-1/forget", "POST", { acknowledgeIrreversiblePurge: true, expectedEntryVersion: "1" }), ["entries", "entry-1", "forget"]],
      [mutationRequest("/reset", "POST", { acknowledgeIrreversiblePurge: true }), ["reset"]],
      [mutationRequest("/exports", "POST", { format: "kokoro_memory_export_v1", includeHistory: true }), ["exports"]],
      [browserRequest("/exports/export-1"), ["exports", "export-1"]],
      [mutationRequest("/imports", "POST", { assetRef: "asset-1", assetVersionRef: "asset-version-1", conflictPolicy: "quarantine", format: "kokoro_memory_export_v1" }), ["imports"]],
      [browserRequest("/imports/import-1"), ["imports", "import-1"]],
      [browserRequest(`/commands/${command.commandId}`), ["commands", command.commandId]],
    ]

    for (const [request, path] of cases) expect((await surface.handle(request, path)).status).toBeLessThan(300)
    expect(Object.values(calls).every((call) => call.mock.calls.length === 1)).toBe(true)
    expect(resolveMemory).toHaveBeenCalledTimes(cases.length)

    expect((await surface.handle(browserRequest("/entries", { method: "DELETE" }), ["entries"])).status).toBe(404)
    expect((await surface.handle(browserRequest("/proxy/platform"), ["proxy", "platform"])).status).toBe(404)
    expect(Object.values(calls).every((call) => call.mock.calls.length === 1)).toBe(true)
    expect(resolveMemory).toHaveBeenCalledTimes(cases.length)
  })

  test("requires same-origin proof for reads and Origin plus operation-bound CSRF for mutations", async () => {
    const getSettings = vi.fn(() => Promise.resolve(settings))
    const memory = authority({ getSettings, updateSettings: () => Promise.resolve(commandResponse()) })
    const surface = api(memory)
    const crossSite = new Request(`${origin}/api/memory/settings`, {
      headers: { "sec-fetch-site": "cross-site" },
    })
    const wrongCsrf = browserRequest("/settings", {
      method: "PATCH",
      headers: { origin, "content-type": "application/json", "x-kokoro-browser-csrf": "wrong" },
      body: JSON.stringify({ command, input: { expectedRevision: "1", savedMemoryUseRequested: false } }),
    })

    expect((await surface.handle(crossSite, ["settings"])).status).toBe(403)
    expect((await surface.handle(wrongCsrf, ["settings"])).status).toBe(403)
    expect(getSettings).not.toHaveBeenCalled()
  })

  test("rejects duplicate, unknown and browser-supplied authority query axes", async () => {
    const listEntries = vi.fn(() => Promise.resolve({ items: [], pageInfo: { nextCursor: null } }))
    const surface = api(authority({ listEntries }))
    for (const query of [
      "?limit=1&limit=2",
      "?search=fox",
      "?siteId=site-2",
      "?subjectRef=subject-2",
      "?projectRef=project-2",
      "?spaceRef=space-2",
      "?namespace=namespace-2",
    ]) {
      expect((await surface.handle(browserRequest(`/entries${query}`), ["entries"])).status).toBe(400)
    }
    expect(listEntries).not.toHaveBeenCalled()
  })

  test("rejects browser-supplied authority axes in closed mutation bodies", async () => {
    const remember = vi.fn(() => Promise.resolve(commandResponse()))
    const surface = api(authority({ remember }))
    const response = await surface.handle(mutationRequest("/entries", "POST", {
      category: "profile",
      content: "Remember me",
      validFrom: null,
      validTo: null,
      projectRef: "browser-project",
    }), ["entries"])

    expect(response.status).toBe(400)
    expect(remember).not.toHaveBeenCalled()
  })

  test("caps mutation bodies at 64 KiB and decodes raw bytes as fatal UTF-8", async () => {
    const remember = vi.fn(() => Promise.resolve(commandResponse()))
    const surface = api(authority({ remember }))
    const declaredOversize = browserRequest("/entries", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "content-length": "65537",
        "x-kokoro-browser-csrf": "browser-csrf",
      },
      body: "{}",
    })
    const invalidUtf8 = browserRequest("/entries", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        "x-kokoro-browser-csrf": "browser-csrf",
      },
      body: Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]),
    })

    expect((await surface.handle(declaredOversize, ["entries"])).status).toBe(413)
    expect((await surface.handle(invalidUtf8, ["entries"])).status).toBe(400)
    expect(remember).not.toHaveBeenCalled()
  })

  test("enforces the contract content limit in UTF-8 bytes and rejects lone surrogates", async () => {
    const remember = vi.fn(() => Promise.resolve(commandResponse()))
    const surface = api(authority({ remember }))
    const submit = (content: string) => surface.handle(mutationRequest("/entries", "POST", {
      category: "profile",
      content,
      validFrom: null,
      validTo: null,
    }), ["entries"])

    expect((await submit("🦊".repeat(4_096))).status).toBe(202)
    expect((await submit("🦊".repeat(4_097))).status).toBe(400)
    expect((await submit("bad\ud800text")).status).toBe(400)
    expect(remember).toHaveBeenCalledTimes(1)
  })

  test("spends one monotonic 30-second budget across auth, context resolution and upstream", async () => {
    let elapsedMs = 0
    const getSettings = vi.fn((_options) => {
      expect(_options.deadlineMs).toBe(29_980)
      return Promise.resolve(settings)
    })
    let authoritySignal: AbortSignal | undefined
    const memory = authority({ getSettings })
    const runtimeWithContext = runtime(memory, {
      memory: (_auth, budget) => {
        authoritySignal = budget.signal
        expect(budget.remainingDeadlineMs()).toBe(29_995)
        elapsedMs = 20
        return Promise.resolve(memory)
      },
    })
    const request = browserRequest("/settings")
    const surface = createSiteMemoryApi({
      runtime: runtimeWithContext,
      readAuthSession: (budget) => {
        expect(budget.signal).toBe(request.signal)
        expect(budget.remainingDeadlineMs()).toBe(30_000)
        elapsedMs = 5
        return auth
      },
      monotonicNow: () => elapsedMs,
    })

    expect((await surface.handle(request, ["settings"])).status).toBe(200)
    expect(authoritySignal).toBe(request.signal)
  })

  test("settles when the browser aborts during auth resolution", async () => {
    const controller = new AbortController()
    const surface = createSiteMemoryApi({
      runtime: runtime(authority()),
      readAuthSession: () => new Promise(() => undefined),
    })
    const response = surface.handle(browserRequest("/settings", { signal: controller.signal }), ["settings"])
    controller.abort("browser disconnected")

    const outcome = await Promise.race([
      response.then(({ status }) => status),
      new Promise<"still_pending">((resolve) => setTimeout(() => resolve("still_pending"), 25)),
    ])
    expect(outcome).toBe(503)
  })

  test("bounds a read whose final upstream promise never settles", async () => {
    const getSettings = vi.fn(() => new Promise<MemorySettings>(() => undefined))
    const response = expiringApi(authority({ getSettings })).handle(browserRequest("/settings"), ["settings"])

    const outcome = await Promise.race([
      response.then(({ status }) => status),
      new Promise<"still_pending">((resolve) => setTimeout(() => resolve("still_pending"), 25)),
    ])
    expect(outcome).toBe(503)
  })

  test("returns same-command recovery when a final mutation promise never settles", async () => {
    const remember = vi.fn(() => new Promise<MemoryCommandResponse>(() => undefined))
    const response = await expiringApi(authority({ remember })).handle(mutationRequest("/entries", "POST", {
      category: "profile",
      content: "Remember me",
      validFrom: null,
      validTo: null,
    }), ["entries"])

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "OUTCOME_UNKNOWN" },
      recovery: { commandId: command.commandId, method: "GET" },
    })
  })

  test("settles when the browser aborts during the final upstream call", async () => {
    const controller = new AbortController()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const getSettings = vi.fn(() => {
      markStarted?.()
      return new Promise<MemorySettings>(() => undefined)
    })
    const surface = api(authority({ getSettings }))
    const response = surface.handle(browserRequest("/settings", { signal: controller.signal }), ["settings"])
    await started
    controller.abort("browser disconnected")

    const outcome = await Promise.race([
      response.then(({ status }) => status),
      new Promise<"still_pending">((resolve) => setTimeout(() => resolve("still_pending"), 25)),
    ])
    expect(outcome).toBe(503)
  })

  test("returns a typed same-command recovery target after an ambiguous mutation failure", async () => {
    const remember = vi.fn(() => Promise.reject(new Error("upstream connection reset")))
    const surface = api(authority({ remember }))
    const response = await surface.handle(mutationRequest("/entries", "POST", {
      category: "profile",
      content: "Remember me",
      validFrom: null,
      validTo: null,
    }), ["entries"])

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "OUTCOME_UNKNOWN",
        message: "Memory command outcome is being reconciled",
      },
      recovery: {
        commandId: command.commandId,
        href: `/api/memory/commands/${command.commandId}`,
        method: "GET",
      },
    })
  })

  test("preserves a definite Platform mutation outcome instead of returning ambiguous recovery", async () => {
    const remember = vi.fn(() => Promise.reject(new PlatformPublicError(409, {
      code: "MEMORY_VERSION_CONFLICT",
      correlationId: "correlation-1",
      requestId: "request-1",
      retryClass: "after_user_action",
      safeMessage: "Memory changed before this command was applied",
    })))
    const response = await api(authority({ remember })).handle(mutationRequest("/entries", "POST", {
      category: "profile",
      content: "Remember me",
      validFrom: null,
      validTo: null,
    }), ["entries"])

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "MEMORY_VERSION_CONFLICT",
        message: "Memory changed before this command was applied",
      },
    })
  })

  test("rejects an oversized serialized upstream response", async () => {
    const getSettings = () => Promise.resolve({ ...settings, unexpected: "x".repeat(2_100_000) } as never)
    const response = await api(authority({ getSettings })).handle(browserRequest("/settings"), ["settings"])

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: { code: "UPSTREAM_RESPONSE_TOO_LARGE" } })
  })
})
