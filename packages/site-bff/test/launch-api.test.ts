import { describe, expect, it } from "vitest"

import type { OpaqueAuthSession } from "@kokoro/bff-runtime"

import { createSiteLaunchApi } from "../src/launch-api.js"

const auth: OpaqueAuthSession = {
  sessionRef: "session-12345678",
  sessionCredential: "s".repeat(64),
  expiresAt: "2026-07-30T00:00:00.000Z",
}

const coreAllowedOperations = [
  "identity.revoke-sessions",
  "identity.enroll-totp",
  "identity.disable-totp",
  "identity.regenerate-recovery-codes",
  "redemption.preview",
  "redemption.confirm",
] as const

function responseCookie(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ")
}

describe("Site launch HTTP boundary", () => {
  it("accepts an internal listener URL after strict ingress Host resolution", async () => {
    const api = createSiteLaunchApi({
      runtime: {
        publicOrigin: "https://site.example",
        deploymentIdentity: {
          deploymentRef: "deployment-12345678",
          webArtifactDigest: "a".repeat(64),
        },
        bindingIdentity: {
          siteProjectBindingRef: "binding-12345678",
          siteReleaseRef: "release-12345678",
        },
        verifyBrowserMutation: () => false,
      } as never,
      stateSecret: "k".repeat(64),
      readAuthSession: async () => null,
    })

    const response = await api.handle(new Request(
      "http://127.0.0.1:4000/api/account/dashboard",
      { headers: { "sec-fetch-site": "same-origin" } },
    ), "dashboard")

    expect(response.status).toBe(401)
  })

  it("rejects Site-disabled acquisition operations before Platform transport", async () => {
    const api = createSiteLaunchApi({
      runtime: {
        publicOrigin: "https://site.example",
        deploymentIdentity: {
          deploymentRef: "deployment-12345678",
          webArtifactDigest: "a".repeat(64),
        },
        bindingIdentity: {
          siteProjectBindingRef: "binding-12345678",
          siteReleaseRef: "release-12345678",
        },
        verifyBrowserMutation: () => true,
        publicCapabilities: async () => {
          throw new Error("Platform transport must not be reached for a disabled operation")
        },
      } as never,
      stateSecret: "k".repeat(64),
      readAuthSession: async () => null,
      allowedOperations: coreAllowedOperations,
    })
    const headers = {
      origin: "https://site.example",
      "sec-fetch-site": "same-origin",
      "x-kokoro-browser-csrf": "csrf-ok",
      "content-type": "application/json",
    }
    const attempts = [
      ["prepare", "identity.register"],
      ["execute", "identity.verify-email"],
      ["recover", "identity.resend-verification"],
    ] as const

    for (const [action, operation] of attempts) {
      const response = await api.handle(new Request(`https://site.example/api/account/${action}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ operation, flowRef: `disabled-${operation.replaceAll(".", "-")}-flow` }),
      }), action)
      expect(response.status).toBe(404)
    }
  })

  it("keeps the complete nine-operation launch set when no release allowlist is supplied", async () => {
    const api = createSiteLaunchApi({
      runtime: {
        publicOrigin: "https://site.example",
        deploymentIdentity: {
          deploymentRef: "deployment-12345678",
          webArtifactDigest: "a".repeat(64),
        },
        bindingIdentity: {
          siteProjectBindingRef: "binding-12345678",
          siteReleaseRef: "release-12345678",
        },
        verifyBrowserMutation: () => true,
        publicCapabilities: async () => ({
          enabledSurfaceIds: ["account", "identity", "security", "redemption"],
          featurePolicyRevision: "policy-1",
        }),
        createCommand: () => ({ commandId: "1".repeat(32), idempotencyKey: "2".repeat(48) }),
        createOneTimeCommand: () => ({
          commandId: "3".repeat(32),
          idempotencyKey: "4".repeat(48),
          receiptRecoveryCapability: "5".repeat(64),
        }),
      } as never,
      stateSecret: "k".repeat(64),
      readAuthSession: async () => auth,
    })
    const headers = {
      origin: "https://site.example",
      "sec-fetch-site": "same-origin",
      "x-kokoro-browser-csrf": "csrf-ok",
      "content-type": "application/json",
    }
    const operations = [
      "identity.register",
      "identity.verify-email",
      "identity.resend-verification",
      "identity.revoke-sessions",
      "identity.enroll-totp",
      "identity.disable-totp",
      "identity.regenerate-recovery-codes",
      "redemption.preview",
      "redemption.confirm",
    ] as const

    for (const [index, operation] of operations.entries()) {
      const response = await api.handle(new Request("https://site.example/api/account/prepare", {
        method: "POST",
        headers,
        body: JSON.stringify({ operation, flowRef: `default-launch-operation-${index}` }),
      }), "prepare")
      expect(response.status).toBe(204)
    }
  })

  it("rejects duplicate or unknown release operation configuration", () => {
    const input = {
      runtime: {
        publicOrigin: "https://site.example",
        deploymentIdentity: {
          deploymentRef: "deployment-12345678",
          webArtifactDigest: "a".repeat(64),
        },
        bindingIdentity: {
          siteProjectBindingRef: "binding-12345678",
          siteReleaseRef: "release-12345678",
        },
      } as never,
      stateSecret: "k".repeat(64),
      readAuthSession: async () => null,
    }

    expect(() => createSiteLaunchApi({
      ...input,
      allowedOperations: ["redemption.preview", "redemption.preview"],
    })).toThrow("unique closed set")
    expect(() => createSiteLaunchApi({
      ...input,
      allowedOperations: ["identity.unknown" as never],
    })).toThrow("unique closed set")
  })

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
      allowedOperations: coreAllowedOperations,
      legalDocuments: [{ termRef: "terms-2026", label: "Terms", href: "https://site.example/terms" }],
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
    expect(body).toContain("https://site.example/terms")
    expect(body).not.toContain("terms-2026")
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

  it("cancels an undeclared streaming body as soon as the bounded envelope is exceeded", async () => {
    let cancelled = false
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls <= 5) controller.enqueue(new Uint8Array(8_192))
        else controller.close()
      },
      cancel() { cancelled = true },
    })
    const api = createSiteLaunchApi({
      runtime: {
        publicOrigin: "https://site.example",
        deploymentIdentity: { deploymentRef: "deployment-12345678", webArtifactDigest: "a".repeat(64) },
        bindingIdentity: { siteProjectBindingRef: "binding-12345678", siteReleaseRef: "release-12345678" },
        verifyBrowserMutation: () => true,
      } as never,
      stateSecret: "k".repeat(64),
      readAuthSession: async () => auth,
    })

    const response = await api.handle(new Request("https://site.example/api/account/prepare", {
      method: "POST",
      headers: {
        origin: "https://site.example",
        "sec-fetch-site": "same-origin",
        "x-kokoro-browser-csrf": "csrf-ok",
        "content-type": "application/json",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }), "prepare")

    expect(response.status).toBe(503)
    expect(cancelled).toBe(true)
    expect(pulls).toBeLessThan(6)
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
    const api = createSiteLaunchApi({
      runtime: runtime as never,
      stateSecret: "k".repeat(64),
      readAuthSession: () => auth,
      legalDocuments: [{ termRef: "terms-authoritative-2026", label: "Terms", href: "https://site.example/terms" }],
      now: () => 1_000,
      nonce: () => Buffer.alloc(12, 8),
    })
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

  it("keeps reauthentication proof server-side through TOTP enrollment and returns recovery codes once", async () => {
    let command = 0
    const calls: unknown[] = []
    const runtime = {
      publicOrigin: "https://site.example",
      deploymentIdentity: { deploymentRef: "deployment-12345678", webArtifactDigest: "a".repeat(64), publicOrigin: "https://site.example" },
      bindingIdentity: { siteProjectBindingRef: "binding-12345678", siteReleaseRef: "release-12345678" },
      createCommand: () => ({ commandId: String(++command).padStart(32, "0"), idempotencyKey: String(command).padStart(48, "0") }),
      createOneTimeCommand: () => ({ commandId: String(++command).padStart(32, "0"), idempotencyKey: String(command).padStart(48, "0"), receiptRecoveryCapability: String(command).padStart(64, "0") }),
      verifyBrowserMutation: () => true,
      publicCapabilities: async () => ({ enabledSurfaceIds: ["security"], featurePolicyRevision: "policy-1" }),
      reauthenticate: async (_auth: OpaqueAuthSession, input: { stage: string }) => {
        calls.push(input)
        if (input.stage === "password") return { receipt: {}, pending: { transactionRef: "reauth-transaction-12345678", challengeKind: "totp", expiresAt: "2026-07-29T00:05:00.000Z" } }
        return { commandId: "2".repeat(32), requestDigest: "d".repeat(64), proof: { audience: "platform-public", operationId: "beginTotpEnrollment", resourceKind: "identity_account", reauthenticationProof: "server-only-proof-12345678901234567890", authStrengthPolicyRevision: "auth-policy-1", issuedAt: "2026-07-29T00:00:00.000Z", expiresAt: "2026-07-29T00:05:00.000Z", sessionRef: "identity-session-12345678", sessionEpoch: "1", userSecurityEpoch: "1" } }
      },
      beginTotpEnrollment: async (_auth: OpaqueAuthSession, input: unknown) => {
        calls.push(input)
        return { commandId: "3".repeat(32), requestDigest: "e".repeat(64), transaction: { transactionRef: "totp-enrollment-12345678", expiresAt: "2026-07-29T00:10:00.000Z", manualEntrySecret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/Image%20Studio:user?secret=JBSWY3DPEHPK3PXP" } }
      },
      confirmTotpEnrollment: async (_auth: OpaqueAuthSession, input: unknown) => {
        calls.push(input)
        return { commandId: "4".repeat(32), requestDigest: "f".repeat(64), generatedAt: "2026-07-29T00:02:00.000Z", recoveryCodes: Array.from({ length: 8 }, (_, index) => `recovery-${index}-code`) }
      },
    }
    const api = createSiteLaunchApi({ runtime: runtime as never, stateSecret: "k".repeat(64), readAuthSession: () => auth,
      now: () => 1_000, nonce: () => Buffer.alloc(12, 7) })
    const headers = { origin: "https://site.example", "sec-fetch-site": "same-origin", "x-kokoro-browser-csrf": "csrf-ok", "content-type": "application/json" }
    const call = (action: "prepare" | "execute", body: unknown, cookieValue = "") => api.handle(new Request(`https://site.example/api/account/${action}`, { method: "POST", headers: { ...headers, cookie: cookieValue }, body: JSON.stringify(body) }), action)

    const prepared = await call("prepare", { operation: "identity.enroll-totp", flowRef: "security-flow-12345678" })
    expect(prepared.status).toBe(204)
    const password = await call("execute", { operation: "identity.enroll-totp", flowRef: "security-flow-12345678", password: "correct horse battery staple" }, responseCookie(prepared))
    expect(await password.json()).toEqual({ state: "mfa_required", challengeKind: "totp", expiresAt: "2026-07-29T00:05:00.000Z" })
    const mfa = await call("execute", { operation: "identity.enroll-totp", flowRef: "security-flow-12345678", code: "123456" }, responseCookie(password))
    expect(await mfa.json()).toEqual({ state: "totp_confirmation_required", manualEntrySecret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/Image%20Studio:user?secret=JBSWY3DPEHPK3PXP", expiresAt: "2026-07-29T00:10:00.000Z" })
    expect(JSON.stringify(await call("execute", { operation: "identity.enroll-totp", flowRef: "security-flow-12345678", code: "234567" }, responseCookie(mfa)).then((response) => response.json()))).toContain("recovery-7-code")
    expect(calls).toEqual([
      expect.objectContaining({ stage: "password" }),
      expect.objectContaining({ stage: "mfa", transactionRef: "reauth-transaction-12345678" }),
      { reauthenticationProof: "server-only-proof-12345678901234567890" },
      { transactionRef: "totp-enrollment-12345678", code: "234567" },
    ])
  })

  it("supersedes a lost one-time reauthentication proof without exposing recovery authority", async () => {
    let sequence = 0
    const deliveries: unknown[] = []
    const runtime = {
      publicOrigin: "https://site.example",
      deploymentIdentity: { deploymentRef: "deployment-12345678", webArtifactDigest: "a".repeat(64), publicOrigin: "https://site.example" },
      bindingIdentity: { siteProjectBindingRef: "binding-12345678", siteReleaseRef: "release-12345678" },
      createCommand: () => ({ commandId: String(++sequence).padStart(32, "0"), idempotencyKey: String(sequence).padStart(48, "0") }),
      createOneTimeCommand: () => ({ commandId: String(++sequence).padStart(32, "0"), idempotencyKey: String(sequence).padStart(48, "0"), receiptRecoveryCapability: String(sequence).padStart(64, "0") }),
      verifyBrowserMutation: () => true,
      publicCapabilities: async () => ({ enabledSurfaceIds: ["security"], featurePolicyRevision: "policy-1" }),
      reauthenticate: async (_auth: OpaqueAuthSession, reauthentication: unknown, delivery: unknown) => {
        deliveries.push({ reauthentication, delivery })
        if (deliveries.length === 1) return { kind: "delivery_unavailable", commandId: "1".repeat(32), requestDigest: "d".repeat(64), receiptRef: "receipt-12345678" }
        return { commandId: "2".repeat(32), requestDigest: "e".repeat(64), proof: {
          audience: "platform-public", operationId: "disableTotp", resourceKind: "identity_account",
          reauthenticationProof: "recovered-server-proof-12345678901234567890", authStrengthPolicyRevision: "auth-policy-1",
          issuedAt: "2026-07-29T00:00:00.000Z", expiresAt: "2026-07-29T00:05:00.000Z",
          sessionRef: "identity-session-12345678", sessionEpoch: "1", userSecurityEpoch: "1",
        } }
      },
      commandReceipt: async () => ({
        receipt: {},
        reconciliation: { kind: "superseding_ceremony_required", ceremony: {
          operationId: "reauthenticateIdentitySession", transactionRef: "reauth-recovery-12345678",
          bindingDigest: "b".repeat(64), expiresAt: "2026-07-29T00:05:00.000Z", invalidatesPriorDelivery: true,
        } },
      }),
      disableTotp: async (_auth: OpaqueAuthSession, input: unknown) => {
        deliveries.push(input)
        return { receipt: {} }
      },
    }
    const api = createSiteLaunchApi({ runtime: runtime as never, stateSecret: "k".repeat(64), readAuthSession: () => auth,
      now: () => 1_000, nonce: () => Buffer.alloc(12, 6) })
    const headers = { origin: "https://site.example", "sec-fetch-site": "same-origin", "x-kokoro-browser-csrf": "csrf-ok", "content-type": "application/json" }
    const call = (action: "prepare" | "execute", body: unknown, cookieValue = "") => api.handle(new Request(`https://site.example/api/account/${action}`, { method: "POST", headers: { ...headers, cookie: cookieValue }, body: JSON.stringify(body) }), action)

    const prepared = await call("prepare", { operation: "identity.disable-totp", flowRef: "disable-flow-12345678" })
    const recovered = await call("execute", { operation: "identity.disable-totp", flowRef: "disable-flow-12345678", password: "correct horse battery staple" }, responseCookie(prepared))
    const recoveredBody = await recovered.text()
    expect(JSON.parse(recoveredBody)).toEqual({ state: "totp_confirmation_required" })
    expect(deliveries[1]).toEqual(expect.objectContaining({ delivery: expect.objectContaining({
      priorCommandId: "1".padStart(32, "0"),
      command: expect.objectContaining({ receiptRecoveryCapability: "1".padStart(64, "0") }),
    }) }))
    expect(recoveredBody).not.toContain("recovered-server-proof")

    const disabled = await call("execute", { operation: "identity.disable-totp", flowRef: "disable-flow-12345678", code: "123456" }, responseCookie(recovered))
    expect(await disabled.json()).toEqual({ state: "succeeded" })
    expect(deliveries[2]).toEqual({ reauthenticationProof: "recovered-server-proof-12345678901234567890", code: "123456" })
  })
})
