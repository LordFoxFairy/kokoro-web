import { describe, expect, it } from "vitest"

import type { OpaqueAuthSession } from "@kokoro/bff-runtime"

import { createSiteLaunchApi } from "../src/launch-api.js"

const auth: OpaqueAuthSession = {
  sessionRef: "session-12345678",
  sessionCredential: "s".repeat(64),
  expiresAt: "2026-07-30T00:00:00.000Z",
}

function responseCookie(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
}

describe("Site launch HTTP boundary", () => {
  it("persists a command before redemption RPC and never returns Code or authority", async () => {
    const calls: string[] = []
    const runtime = {
      publicOrigin: "https://site.example",
      deploymentIdentity: { deploymentRef: "deployment-12345678", webArtifactDigest: "a".repeat(64), publicOrigin: "https://site.example" },
      bindingIdentity: { siteProjectBindingRef: "binding-12345678", siteReleaseRef: "release-12345678" },
      createCommand: () => ({ commandId: "1".repeat(32), idempotencyKey: "2".repeat(48) }),
      createOneTimeCommand: () => ({ commandId: "3".repeat(32), idempotencyKey: "4".repeat(48), receiptRecoveryCapability: "5".repeat(64) }),
      verifyBrowserMutation: ({ token }: { token: string }) => token === "csrf-ok",
      publicCapabilities: async () => ({ enabledSurfaceIds: ["identity", "redemption"], featurePolicyRevision: "policy-1" }),
      previewRedemption: async (_auth: OpaqueAuthSession, code: string) => {
        calls.push(code)
        return { receipt: {}, preview: { previewCredential: "opaque-preview-credential-1234567890", legalTermRefs: ["terms-2026"], safeProductLabel: "Starter credits", safePlanLabel: null, productKind: "credit_pack", expiresAt: "2026-07-29T01:00:00.000Z", term: { action: "none", automaticRenewal: false, startsAt: null, endsAt: null }, entitlements: [], credits: [{ amount: "100", unit: "credit", bucketClass: "permanent", expiresAt: null }] } }
      },
    }
    const api = createSiteLaunchApi({
      runtime: runtime as never,
      stateSecret: "k".repeat(64),
      readAuthSession: async () => auth,
      registrationLegalAcceptanceRefs: ["terms-2026"],
      now: () => 1_000,
      nonce: () => Buffer.alloc(12, 7),
    })
    const headers = { origin: "https://site.example", "sec-fetch-site": "same-origin", "x-kokoro-browser-csrf": "csrf-ok", "content-type": "application/json" }
    const prepared = await api.handle(new Request("https://site.example/api/account/prepare", { method: "POST", headers, body: JSON.stringify({ operation: "redemption.preview", flowRef: "launch-flow-12345678" }) }), "prepare")
    expect(prepared.status).toBe(204)
    const cookie = prepared.headers.get("set-cookie")
    expect(cookie).toContain("HttpOnly")
    expect(cookie).not.toContain("11111111")

    const executed = await api.handle(new Request("https://site.example/api/account/execute", { method: "POST", headers: { ...headers, cookie: cookie?.split(";", 1)[0] ?? "" }, body: JSON.stringify({ operation: "redemption.preview", flowRef: "launch-flow-12345678", code: "RAW-CODE-123456789" }) }), "execute")
    expect(executed.status).toBe(200)
    expect(calls).toEqual(["RAW-CODE-123456789"])
    const body = await executed.text()
    expect(body).toContain("Starter credits")
    expect(body).not.toContain("RAW-CODE")
    expect(body).not.toContain("opaque-preview")
    expect(body).not.toContain("11111111")
  })

  it("fails closed before state or RPC when browser CSRF is missing", async () => {
    const api = createSiteLaunchApi({
      runtime: {
        publicOrigin: "https://site.example",
        deploymentIdentity: { deploymentRef: "deployment-12345678", webArtifactDigest: "a".repeat(64) },
        bindingIdentity: { siteProjectBindingRef: "binding-12345678", siteReleaseRef: "release-12345678" },
        verifyBrowserMutation: () => false,
      } as never,
      stateSecret: "k".repeat(64),
      readAuthSession: async () => auth,
    })
    const response = await api.handle(new Request("https://site.example/api/account/prepare", { method: "POST" }), "prepare")
    expect(response.status).toBe(403)
  })

  it("requires explicit legal acceptance while taking authoritative term refs only from sealed preview state", async () => {
    const confirmations: unknown[] = []
    const runtime = {
      publicOrigin: "https://site.example",
      deploymentIdentity: { deploymentRef: "deployment-12345678", webArtifactDigest: "a".repeat(64), publicOrigin: "https://site.example" },
      bindingIdentity: { siteProjectBindingRef: "binding-12345678", siteReleaseRef: "release-12345678" },
      createCommand: (() => { let sequence = 0; return () => ({ commandId: String(++sequence).padStart(32, "0"), idempotencyKey: String(sequence).padStart(48, "0") }) })(),
      createOneTimeCommand: () => ({ commandId: "3".repeat(32), idempotencyKey: "4".repeat(48), receiptRecoveryCapability: "5".repeat(64) }),
      verifyBrowserMutation: () => true,
      publicCapabilities: async () => ({ enabledSurfaceIds: ["redemption"], featurePolicyRevision: "policy-1" }),
      previewRedemption: async () => ({ receipt: {}, preview: { previewCredential: "opaque-preview-credential-1234567890", legalTermRefs: ["terms-authoritative-2026"], safeProductLabel: "Starter credits", safePlanLabel: null, productKind: "credit_pack", expiresAt: "2026-07-29T01:00:00.000Z", term: { action: "none", automaticRenewal: false, startsAt: null, endsAt: null }, entitlements: [], credits: [] } }),
      confirmRedemption: async (_auth: OpaqueAuthSession, input: unknown) => { confirmations.push(input); return { kind: "succeeded", redemption: { state: "fulfilled", redeemedAt: "2026-07-29T00:30:00.000Z" } } },
    }
    const api = createSiteLaunchApi({ runtime: runtime as never, stateSecret: "k".repeat(64), readAuthSession: () => auth, now: () => 1_000, nonce: () => Buffer.alloc(12, 8) })
    const headers = { origin: "https://site.example", "sec-fetch-site": "same-origin", "x-kokoro-browser-csrf": "csrf-ok", "content-type": "application/json" }
    const call = (action: "prepare" | "execute", body: unknown, cookieValue = "") => api.handle(new Request(`https://site.example/api/account/${action}`, { method: "POST", headers: { ...headers, cookie: cookieValue }, body: JSON.stringify(body) }), action)

    const previewPrepared = await call("prepare", { operation: "redemption.preview", flowRef: "preview-flow-12345678" })
    const previewed = await call("execute", { operation: "redemption.preview", flowRef: "preview-flow-12345678", code: "RAW-CODE-123456789" }, responseCookie(previewPrepared))
    const confirmPrepared = await call("prepare", { operation: "redemption.confirm", flowRef: "confirm-flow-12345678" }, responseCookie(previewed))
    const withoutAcceptance = await call("execute", { operation: "redemption.confirm", flowRef: "confirm-flow-12345678", previewFlowRef: "preview-flow-12345678" }, responseCookie(confirmPrepared))
    expect(withoutAcceptance.status).toBe(400)
    expect(confirmations).toEqual([])

    const accepted = await call("execute", { operation: "redemption.confirm", flowRef: "confirm-flow-12345678", previewFlowRef: "preview-flow-12345678", legalAccepted: true, legalAcceptanceRefs: ["browser-must-not-be-trusted"] }, responseCookie(confirmPrepared))
    expect(accepted.status).toBe(200)
    expect(confirmations).toEqual([{ previewCredential: "opaque-preview-credential-1234567890", legalAcceptanceRefs: ["terms-authoritative-2026"] }])
  })
})
