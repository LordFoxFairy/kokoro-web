import { SessionAccessError, SessionProxyError, type OpaqueAuthSession } from "@kokoro/bff-runtime"
import { errorEnvelopeSchema } from "@kokoro/session-client/contracts"
import { PlatformPublicError } from "@kokoro/site-client/server"
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

function streamRequest(): Request {
  return new Request(
    "https://site.example/v1/sessions/session-12345678/events?after=opaque-cursor-12345678",
    {
      headers: {
        accept: "text/event-stream",
        "last-event-id": "opaque-cursor-12345678",
        "sec-fetch-site": "same-origin",
      },
    },
  )
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
    [new SessionAccessError("GRANT_INVALID"), "grant_validation"],
    [new PlatformPublicError(503, {
      code: "SITE_UNAVAILABLE",
      correlationId: "private-platform-correlation",
      receiptRef: "private-platform-receipt",
      requestId: "private-platform-request",
      retryClass: "after_delay",
      safeMessage: "private Platform authority detail",
    }), "grant_authority"],
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

  it.each([
    [Object.assign(new SessionAccessError("GRANT_BINDING_MISMATCH"), {
      status: 419,
      ref: "private-validation-ref",
      credential: "private-validation-credential",
    }), ["419", "GRANT_BINDING_MISMATCH", "private-validation-ref", "private-validation-credential"]],
    [Object.assign(new PlatformPublicError(529, {
      code: "SITE_UNAVAILABLE",
      correlationId: "private-authority-correlation",
      receiptRef: "private-authority-receipt",
      requestId: "private-authority-request",
      retryClass: "after_delay",
      safeMessage: "private authority message",
    }), { credential: "private-authority-credential" }), [
      "529",
      "SITE_UNAVAILABLE",
      "private-authority-correlation",
      "private-authority-receipt",
      "private-authority-request",
      "private authority message",
      "private-authority-credential",
    ]],
  ] as const)("does not disclose private grant failure details for %s", async (error, forbidden) => {
    const api = createSiteSessionApi({
      runtime: runtime(vi.fn(async () => { throw error })),
      readAuthSession: () => auth,
    })

    const response = await api.handle(mutationRequest(), ["v1", "sessions"])
    const visible = `${response.headers.get("x-kokoro-session-failure-phase")}\n${await response.text()}`

    expect(response.status).toBe(503)
    for (const secret of forbidden) expect(visible).not.toContain(secret)
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

  it("uses the generated problem media type for every local failure class", async () => {
    const missingAuth = await createSiteSessionApi({
      runtime: runtime(vi.fn()),
      readAuthSession: () => null,
    }).handle(request(), ["v1", "sessions", "session-12345678", "snapshot"])
    const forbidden = await createSiteSessionApi({
      runtime: runtime(vi.fn()),
      readAuthSession: () => auth,
    }).handle(
      new Request("https://site.example/v1/sessions/session-12345678/snapshot"),
      ["v1", "sessions", "session-12345678", "snapshot"],
    )
    const invalidBody = await createSiteSessionApi({
      runtime: runtime(vi.fn()),
      readAuthSession: () => auth,
    }).handle(new Request("https://site.example/v1/sessions", {
      method: "POST",
      headers: {
        "content-type": "text/plain",
        origin: "https://site.example",
        "sec-fetch-site": "same-origin",
      },
      body: "{}",
    }), ["v1", "sessions"])
    const oversized = await createSiteSessionApi({
      runtime: runtime(vi.fn()),
      readAuthSession: () => auth,
    }).handle(new Request("https://site.example/v1/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://site.example",
        "sec-fetch-site": "same-origin",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(2_097_153).fill(0x78))
          controller.close()
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" }), ["v1", "sessions"])
    const upstreamProtocol = await createSiteSessionApi({
      runtime: runtime(vi.fn(async () => { throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR") })),
      readAuthSession: () => auth,
    }).handle(request(), ["v1", "sessions", "session-12345678", "snapshot"])
    const streamUnavailable = await createSiteSessionApi({
      runtime: {
        publicOrigin: "https://site.example",
        assemble: vi.fn(async () => { throw new Error("private assembly detail") }),
      },
      readAuthSession: () => auth,
    }).handle(streamRequest(), ["v1", "sessions", "session-12345678", "events"])

    const responses = [
      missingAuth,
      forbidden,
      invalidBody,
      oversized,
      upstreamProtocol,
      streamUnavailable,
    ]
    expect(responses.map(({ status }) => status)).toEqual([401, 403, 400, 413, 502, 503])
    for (const response of responses) {
      expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8")
      errorEnvelopeSchema.parse(await response.clone().json())
    }
    const streamProblem = errorEnvelopeSchema.parse(await streamUnavailable.json())
    expect(streamProblem.error).toMatchObject({
      code: "INTERNAL_UNAVAILABLE",
      action: "retry_same_cursor",
      retry_class: "after_delay",
    })
  })
})
