import { SessionProxyError, type OpaqueAuthSession } from "@kokoro/bff-runtime"
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
})
