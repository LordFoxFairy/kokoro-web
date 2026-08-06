import { SessionAccessError, SessionProxyError, type OpaqueAuthSession } from "@kokoro/bff-runtime"
import { errorEnvelopeSchema } from "@kokoro/session-client/contracts"
import { describe, expect, it, vi } from "vitest"

import { createSiteSessionApi, type SiteSessionApiRuntime } from "../src/session-api.js"

const auth: OpaqueAuthSession = {
  sessionRef: "identity-session-12345678",
  sessionCredential: "s".repeat(32),
  expiresAt: "2026-07-30T00:00:00Z",
}

function request(method = "GET"): Request {
  return new Request("https://site.example/v1/sessions/session-12345678/snapshot", {
    method,
    headers: { "sec-fetch-site": "same-origin", ...(method === "GET" ? {} : { origin: "https://site.example" }) },
  })
}

function mutationRequest(): Request {
  return new Request("https://site.example/v1/sessions/session-12345678", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://site.example",
      "sec-fetch-site": "same-origin",
    },
    body: "{}",
  })
}

function runtime(execute: SiteSessionApiRuntime["assemble"] extends (...args: readonly unknown[]) => Promise<infer Result>
  ? Result["proxy"]["execute"]
  : never): SiteSessionApiRuntime {
  return {
    publicOrigin: "https://site.example",
    assemble: vi.fn(async () => ({
      bootstrap: { defaultProjectRef: "project-12345678" },
      proxy: { execute },
    })),
  }
}

describe("Site Session API", () => {
  it("returns the generated auth problem without touching Session when the Site session is absent", async () => {
    const execute = vi.fn()
    const api = createSiteSessionApi({ runtime: runtime(execute), readAuthSession: () => null })

    const response = await api.handle(request(), ["v1", "sessions", "session-12345678", "snapshot"])

    expect(response.status).toBe(401)
    expect(errorEnvelopeSchema.parse(await response.json()).error).toMatchObject({
      code: "SESSION_ACCESS_GRANT_REQUIRED",
      action: "reauthenticate",
      retry_class: "never",
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it("maps a browser trust rejection to 403 instead of presenting it as invalid contract input", async () => {
    const api = createSiteSessionApi({
      runtime: runtime(vi.fn(async () => { throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED") })),
      readAuthSession: () => auth,
    })

    const response = await api.handle(request(), ["v1", "sessions", "session-12345678", "snapshot"])

    expect(response.status).toBe(403)
    expect(errorEnvelopeSchema.parse(await response.json()).error.code).toBe("REQUEST_INVALID")
  })

  it("maps an authenticated snapshot protocol failure to an authoritative refetch", async () => {
    const api = createSiteSessionApi({
      runtime: runtime(vi.fn(async () => { throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR") })),
      readAuthSession: () => auth,
    })

    const response = await api.handle(request(), ["v1", "sessions", "session-12345678", "snapshot"])
    const problem = errorEnvelopeSchema.parse(await response.json())

    expect(response.status).toBe(502)
    expect(problem.error).toMatchObject({
      code: "INTERNAL_UNAVAILABLE",
      action: "refetch_snapshot",
      retry_class: "after_delay",
    })
  })

  it("maps an ambiguous mutation failure to receipt reconciliation", async () => {
    const api = createSiteSessionApi({
      runtime: runtime(vi.fn(async () => { throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR") })),
      readAuthSession: () => auth,
    })
    const mutation = new Request("https://site.example/v1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://site.example",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    })

    const response = await api.handle(mutation, ["v1", "sessions"])
    const problem = errorEnvelopeSchema.parse(await response.json())

    expect(response.status).toBe(502)
    expect(problem.error).toMatchObject({
      code: "INTERNAL_UNAVAILABLE",
      action: "reconcile_receipt",
      retry_class: "reconcile_receipt",
    })
  })

  it.each([
    [new SessionAccessError("GRANT_INVALID"), "grant_issue"],
    [new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"), "upstream_contract"],
    [Object.assign(new Error("private transport detail"), { name: "NodeSiteRuntimeError" }), "upstream_transport"],
    [new Error("private proxy detail"), "proxy_internal"],
  ] as const)("publishes only a finite proxy failure phase for %s", async (error, expectedPhase) => {
    const api = createSiteSessionApi({
      runtime: runtime(vi.fn(async () => { throw error })),
      readAuthSession: () => auth,
    })

    const response = await api.handle(mutationRequest(), ["v1", "sessions"])

    expect(response.status).toBeGreaterThanOrEqual(502)
    expect(response.headers.get("x-kokoro-session-failure-phase")).toBe(expectedPhase)
  })

  it("distinguishes runtime assembly failure from a returned upstream problem", async () => {
    const assemblyApi = createSiteSessionApi({
      runtime: {
        publicOrigin: "https://site.example",
        assemble: vi.fn(async () => { throw new Error("private assembly detail") }),
      },
      readAuthSession: () => auth,
    })
    const assemblyFailure = await assemblyApi.handle(mutationRequest(), ["v1", "sessions"])
    const returnedProblem = Response.json(errorEnvelopeSchema.parse({
      error: {
        code: "INTERNAL_UNAVAILABLE",
        message: "Session is unavailable",
        retry_class: "after_delay",
        action: "retry_same_cursor",
      },
      request_id: "request-12345678",
      correlation_id: "correlation-12345678",
    }), { status: 503 })
    const upstreamApi = createSiteSessionApi({
      runtime: runtime(vi.fn(async () => returnedProblem)),
      readAuthSession: () => auth,
    })
    const upstreamFailure = await upstreamApi.handle(mutationRequest(), ["v1", "sessions"])

    expect(assemblyFailure.headers.get("x-kokoro-session-failure-phase")).toBe("runtime_assembly")
    expect(upstreamFailure.headers.has("x-kokoro-session-failure-phase")).toBe(false)
  })
})
