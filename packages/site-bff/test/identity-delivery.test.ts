import { describe, expect, it } from "vitest"

import type { SiteDeploymentBinding } from "@kokoro/bff-runtime"
import type { PlatformPublicRequest, PlatformPublicTransport } from "@kokoro/site-client/server"
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node"

import { createSiteBffRuntime } from "../src/index.js"

const binding: SiteDeploymentBinding = {
  runtimeEnvironment: "production",
  siteProjectBindingRef: "binding-12345678",
  deploymentRef: "deployment-12345678",
  siteReleaseRef: "release-12345678",
  webArtifactDigest: "a".repeat(64),
  workloadCredential: "w".repeat(64),
  sessionContractRevision: "session-v3",
  region: "us-east",
  productAudience: "product-audience-12345678",
  trustMode: "registered",
}

describe("one-time Platform identity delivery", () => {
  it("uses generated secret command security and the typed refresh supersede path", async () => {
    const requests: PlatformPublicRequest<never>[] = []
    const transport: PlatformPublicTransport = {
      async execute(request) {
        requests.push(request as PlatformPublicRequest<never>)
        const commandId = request.headers["X-Kokoro-Command-Id"]
        if (commandId === undefined) throw new Error("missing command id")
        return {
          status: 200,
          body: {
            commandId,
            requestDigest: "b".repeat(64),
            credentials: {
              sessionRef: "identity-session-12345678",
              sessionCredential: "s".repeat(64),
              sessionCredentialExpiresAt: "2026-07-30T00:00:00.000Z",
              refreshCredential: "r".repeat(64),
              refreshCredentialExpiresAt: "2026-08-30T00:00:00.000Z",
            },
          },
        }
      },
    }
    const provider = {
      platformTransport: () => transport,
      sessionHttp: () => ({ send: async () => { throw new Error("not used") } }),
      platformCsrfToken: () => "c".repeat(64),
      issueBrowserCsrf: () => "browser-csrf",
      verifyBrowserCsrf: () => true,
      close: () => undefined,
    } satisfies NodeSiteRuntimeProvider
    const runtime = createSiteBffRuntime({
      binding,
      publicOrigin: "https://site.example",
      provider,
    })

    await runtime.login(
      { email: "USER@example.com", password: "correct horse battery staple" },
      { command: runtime.createOneTimeCommand() },
    )
    await runtime.completeMfa(
      { transactionRef: "mfa-transaction-12345678", code: "123456" },
      { command: runtime.createOneTimeCommand() },
    )
    const original = runtime.createOneTimeCommand()
    await runtime.refresh("r".repeat(64), { command: original })
    const superseding = runtime.createOneTimeCommand()
    await runtime.refresh("ignored-after-consumption", {
      command: superseding,
      priorCommandId: original.commandId,
    })

    expect(requests.map((request) => request.operationId)).toEqual([
      "createIdentitySession",
      "completeSessionMfa",
      "refreshIdentitySession",
      "refreshIdentitySession",
    ])
    for (const request of requests) {
      expect(request.security.receiptRecoveryCapability).toMatch(/^[0-9a-f]{64}$/u)
      expect(request.headers["X-Kokoro-Command-Id"]).toMatch(/^[0-9a-f]{32}$/u)
      expect(request.headers["Idempotency-Key"]).toMatch(/^[0-9a-f]{48}$/u)
    }
    expect(requests[3]?.body).toEqual({
      priorCommandId: original.commandId,
      recoveryAction: "supersede_refresh_delivery",
    })
  })

  it("keeps launch identity, account and redemption operations on the generated server client", async () => {
    const requests: PlatformPublicRequest<never>[] = []
    const transport: PlatformPublicTransport = {
      async execute(request) {
        requests.push(request as PlatformPublicRequest<never>)
        switch (request.operationId) {
          case "beginRegistration":
          case "resendEmailVerification": return { status: 200, body: {
            receipt: { commandId: request.headers["X-Kokoro-Command-Id"], requestDigest: "d".repeat(64), receiptRef: "receipt-12345678", state: "committed", committedAt: "2026-07-29T00:00:00.000Z" },
            transaction: { transactionRef: "verification-12345678", expiresAt: "2026-07-30T00:00:00.000Z", deliveryState: "sent" },
          } }
          case "completeEmailVerification": return { status: 200, body: {
            receipt: { commandId: request.headers["X-Kokoro-Command-Id"], requestDigest: "d".repeat(64), receiptRef: "receipt-12345678", state: "committed", committedAt: "2026-07-29T00:00:00.000Z" },
            accountRef: "account-12345678", personalContextPending: false,
          } }
          case "listIdentitySessions": return { status: 200, body: { revision: "revision-12345678", sessions: [] } }
          case "revokeIdentitySessions": return { status: 200, body: { receipt: { commandId: request.headers["X-Kokoro-Command-Id"], requestDigest: "d".repeat(64), receiptRef: "receipt-12345678", state: "committed", committedAt: "2026-07-29T00:00:00.000Z" } } }
          case "previewRedemption": {
            const body = { receipt: { commandId: request.headers["X-Kokoro-Command-Id"], requestDigest: "d".repeat(64), receiptRef: "receipt-12345678", state: "committed", committedAt: "2026-07-29T00:00:00.000Z" }, preview: {
            previewRef: "preview-12345678", previewCredential: "opaque-preview-credential-1234567890", previewDigest: "e".repeat(64), expiresAt: "2026-07-29T01:00:00.000Z", productRef: "product-12345678", productVersionRef: "version-12345678", productKind: "credit_pack", safeProductLabel: "Starter credits", safePlanLabel: null, planRef: null, planVersionRef: null, legalTermRefs: ["terms-2026"], term: { action: "none", automaticRenewal: false, startsAt: null, endsAt: null }, entitlements: [], credits: [{ amount: "100", unit: "credit", bucketClass: "permanent", expiresAt: null, creditProgramRevisionRef: "credit-program-12345678" }],
            } }
            return { status: 200, body }
          }
          case "confirmRedemption":
          case "recoverRedemptionCommand": return { status: 200, body: { kind: "accepted", retryAfter: "2026-07-29T00:00:02.000Z", command: { commandId: request.headers["X-Kokoro-Command-Id"] ?? "f".repeat(32), requestDigest: "d".repeat(64), receiptRef: "receipt-12345678", receivedAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z" } } }
          case "listAccountProducts": return { status: 200, body: { freshness: { asOf: "2026-07-29T00:00:00.000Z", lagSeconds: 0, revision: "1", state: "current" }, products: [] } }
          case "getCreditSummary": return { status: 200, body: { activeHoldCount: 0, freshness: { asOf: "2026-07-29T00:00:00.000Z", lagSeconds: 0, revision: "1", state: "current" }, units: [] } }
          default: throw new Error(`unexpected operation: ${request.operationId}`)
        }
      },
    }
    const provider = {
      platformTransport: () => transport,
      sessionHttp: () => ({ send: async () => { throw new Error("not used") } }),
      platformCsrfToken: () => "c".repeat(64),
      issueBrowserCsrf: () => "browser-csrf",
      verifyBrowserCsrf: ({ operationId, token }: { operationId: string; token: string }) => operationId === "account.launch" && token === "browser-csrf",
      close: () => undefined,
    } satisfies NodeSiteRuntimeProvider
    const runtime = createSiteBffRuntime({ binding, publicOrigin: "https://site.example", provider })
    const auth = { sessionRef: "identity-session-12345678", sessionCredential: "s".repeat(64), expiresAt: "2026-07-30T00:00:00.000Z" }

    await runtime.register({ email: "USER@example.com", password: "correct horse battery staple", legalAcceptanceRefs: ["terms-2026"] }, runtime.createCommand())
    await runtime.resendVerification("USER@example.com", runtime.createCommand())
    await runtime.completeEmailVerification({ transactionRef: "verification-12345678", transactionSecret: "v".repeat(64) }, { command: runtime.createOneTimeCommand() })
    await runtime.listSecuritySessions(auth)
    await runtime.revokeSessions(auth, { target: "others" }, runtime.createCommand())
    const preview = await runtime.previewRedemption(auth, "RAW-CODE-NEVER-PERSISTED", runtime.createCommand())
    await runtime.confirmRedemption(auth, { previewCredential: preview.preview.previewCredential, legalAcceptanceRefs: preview.preview.legalTermRefs }, runtime.createCommand())
    await runtime.recoverRedemption(auth, runtime.createCommand().idempotencyKey)
    await runtime.accountProducts(auth)
    await runtime.creditSummary(auth)

    expect(requests.map(({ operationId }) => operationId)).toEqual([
      "beginRegistration", "resendEmailVerification", "completeEmailVerification", "listIdentitySessions",
      "revokeIdentitySessions", "previewRedemption", "confirmRedemption", "recoverRedemptionCommand",
      "listAccountProducts", "getCreditSummary",
    ])
    expect(runtime.verifyBrowserMutation({ operationId: "account.launch", token: "browser-csrf" })).toBe(true)
    expect(requests.find(({ operationId }) => operationId === "previewRedemption")?.body).toEqual({ code: "RAW-CODE-NEVER-PERSISTED" })
  })
})
