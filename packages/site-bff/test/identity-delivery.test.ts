import { describe, expect, it } from "vitest"

import type { SiteDeploymentBinding } from "@kokoro/bff-runtime"
import type { PlatformPublicRequest, PlatformPublicTransport } from "@kokoro/site-client/server"
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node"

import { createSiteBffRuntime, supersedeSiteDelivery } from "../src/index.js"

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
  it("propagates the media request budget through personal project resolution", async () => {
    const issuedAt = new Date()
    const requests: PlatformPublicRequest<never>[] = []
    const transport: PlatformPublicTransport = { async execute(request) {
      requests.push(request as PlatformPublicRequest<never>)
      if (request.operationId === "exchangeProductContext") {
        const commandId = request.headers["X-Kokoro-Command-Id"] ?? "1".repeat(32)
        return { status: 200, body: {
          receipt: {
            commandId,
            committedAt: issuedAt.toISOString(),
            receiptRef: "receipt-product-context-12345678",
            requestDigest: "d".repeat(64),
            state: "committed",
          },
          context: {
            productContextRef: "product-context-12345678",
            siteProjectBindingRef: binding.siteProjectBindingRef,
            deploymentRef: binding.deploymentRef,
            siteRef: "site-12345678",
            siteReleaseRef: binding.siteReleaseRef,
            webArtifactDigest: binding.webArtifactDigest,
            runtimeEnvironment: binding.runtimeEnvironment,
            region: binding.region,
            audience: binding.productAudience,
            sessionContractRevision: binding.sessionContractRevision,
            policyEpoch: "4",
            revocationEpoch: "2",
            enabledSurfaceIds: ["image"],
            featurePolicyRevision: "feature-policy-12345678",
            modelOptionCatalogRef: "model-options-12345678",
            modelOptionCatalogs: [{
              surfaceId: "image",
              catalogRevisionRef: "image-catalog-12345678",
              defaultModelOptionRevisionRef: "image-option-12345678",
              options: [{
                modelOptionRevisionRef: "image-option-12345678",
                optionKey: "image.standard",
                label: "Standard",
                inputModalities: ["text"],
                outputModalities: ["image"],
                supportedEfforts: [],
                badges: [],
                availability: "available",
              }],
              publishedAt: issuedAt.toISOString(),
            }],
            agentCatalogRef: "agent-catalog-12345678",
            localePolicy: { defaultLocale: "en-US", allowedLocales: ["en-US"] },
            cacheMaxAgeSeconds: 30,
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + 240_000).toISOString(),
          },
        } }
      }
      if (request.operationId === "getPersonalContext") return { status: 200, body: {
        personalContextRef: "personal-context-12345678",
        productContextRef: "product-context-12345678",
        actor: {
          subjectRef: "subject-12345678",
          subjectGeneration: "1",
          state: "active",
          displayName: "Example User",
          avatarUrl: null,
        },
        projects: [{
          projectRef: "project-12345678",
          workspaceRef: "workspace-12345678",
          executionSpaceRef: "execution-space-12345678",
          displayName: "Personal",
          membershipRevision: "membership-12345678",
        }],
        defaultProjectRef: "project-12345678",
        contextRevision: "personal-revision-12345678",
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 180_000).toISOString(),
      } }
      throw new Error(`unexpected operation: ${request.operationId}`)
    } }
    const provider = {
      platformTransport: () => transport,
      artifactDeliveryTransport: () => ({ redeem: async () => { throw new Error("not used") } }),
      sessionHttp: () => ({ send: async () => { throw new Error("not used") } }),
      platformCsrfToken: () => "c".repeat(64),
      issueBrowserCsrf: () => "browser-csrf",
      verifyBrowserCsrf: () => true,
      close: () => undefined,
    } as unknown as NodeSiteRuntimeProvider
    const runtime = createSiteBffRuntime({ binding, publicOrigin: "https://site.example", provider })
    const controller = new AbortController()
    const remainingDeadlineMs = () => 1_234

    await runtime.media({
      sessionRef: "identity-session-12345678",
      sessionCredential: "s".repeat(64),
      expiresAt: new Date(issuedAt.getTime() + 300_000).toISOString(),
    }, { signal: controller.signal, remainingDeadlineMs })

    const personalRequest = requests.find(({ operationId }) => operationId === "getPersonalContext")
    expect(personalRequest?.signal).toBe(controller.signal)
    expect(personalRequest?.deadlineMs).toBe(1_234)
  })

  it("reuses only the prior raw recovery capability when a delivery command is superseded", () => {
    const prior = { command: {
      commandId: "1".repeat(32),
      idempotencyKey: "2".repeat(48),
      receiptRecoveryCapability: "3".repeat(64),
    } }
    const fresh = {
      commandId: "4".repeat(32),
      idempotencyKey: "5".repeat(48),
      receiptRecoveryCapability: "6".repeat(64),
    }

    expect(supersedeSiteDelivery(prior, fresh)).toEqual({
      command: {
        commandId: fresh.commandId,
        idempotencyKey: fresh.idempotencyKey,
        receiptRecoveryCapability: prior.command.receiptRecoveryCapability,
      },
      priorCommandId: prior.command.commandId,
    })

    const secondFresh = {
      commandId: "7".repeat(32),
      idempotencyKey: "8".repeat(48),
      receiptRecoveryCapability: "9".repeat(64),
    }
    expect(supersedeSiteDelivery(supersedeSiteDelivery(prior, fresh), secondFresh)).toEqual({
      command: {
        commandId: secondFresh.commandId,
        idempotencyKey: secondFresh.idempotencyKey,
        receiptRecoveryCapability: prior.command.receiptRecoveryCapability,
      },
      priorCommandId: fresh.commandId,
    })
  })

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
    const superseding = supersedeSiteDelivery({ command: original }, runtime.createOneTimeCommand())
    await runtime.refresh("ignored-after-consumption", superseding)

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
    expect(requests[3]?.security.receiptRecoveryCapability).toBe(original.receiptRecoveryCapability)
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
            accountRef: "account-12345678",
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

  it("keeps account security proofs and delivery recovery behind the Site BFF", async () => {
    const requests: PlatformPublicRequest<never>[] = []
    const transport: PlatformPublicTransport = { async execute(request) {
      requests.push(request as PlatformPublicRequest<never>)
      const commandId = request.headers["X-Kokoro-Command-Id"] ?? "1".repeat(32)
      const requestDigest = "d".repeat(64)
      const receipt = { commandId, requestDigest, receiptRef: "receipt-security-12345678", state: "committed", committedAt: "2026-07-29T00:00:00.000Z" }
      switch (request.operationId) {
        case "reauthenticateIdentitySession": return { status: 200, body: { commandId, requestDigest, proof: {
          audience: "platform-public", operationId: "beginTotpEnrollment", resourceKind: "identity_account",
          reauthenticationProof: "p".repeat(64), authStrengthPolicyRevision: "auth-policy-1",
          issuedAt: "2026-07-29T00:00:00.000Z", expiresAt: "2026-07-29T00:05:00.000Z",
          sessionRef: "identity-session-12345678", sessionEpoch: "1", userSecurityEpoch: "2",
        } } }
        case "beginTotpEnrollment": return { status: 200, body: { commandId, requestDigest, transaction: {
          transactionRef: "totp-enrollment-12345678", expiresAt: "2026-07-29T00:10:00.000Z",
          manualEntrySecret: "JBSWY3DPEHPK3PXP", otpauthUri: "otpauth://totp/Image%20Studio:user@example.com?secret=JBSWY3DPEHPK3PXP",
        } } }
        case "confirmTotpEnrollment":
        case "regenerateRecoveryCodes": return { status: 200, body: { commandId, requestDigest,
          generatedAt: "2026-07-29T00:01:00.000Z",
          recoveryCodes: Array.from({ length: 8 }, (_, index) => `recovery-${index}-code`),
        } }
        case "disableTotp": return { status: 200, body: { receipt } }
        default: throw new Error(`unexpected operation: ${request.operationId}`)
      }
    } }
    const provider = {
      platformTransport: () => transport,
      sessionHttp: () => ({ send: async () => { throw new Error("not used") } }),
      platformCsrfToken: () => "c".repeat(64), issueBrowserCsrf: () => "browser-csrf",
      verifyBrowserCsrf: () => true, close: () => undefined,
    } satisfies NodeSiteRuntimeProvider
    const runtime = createSiteBffRuntime({ binding, publicOrigin: "https://site.example", provider })
    const auth = { sessionRef: "identity-session-12345678", sessionCredential: "s".repeat(64), expiresAt: "2026-07-30T00:00:00.000Z" }
    const target = { audience: "platform-public" as const, operationId: "beginTotpEnrollment" as const,
      resource: { kind: "identity_account" as const } }

    const proof = await runtime.reauthenticate(auth, { stage: "password", password: "correct horse battery staple", target }, { command: runtime.createOneTimeCommand() })
    if (!("proof" in proof)) throw new Error("expected proof")
    const enrollment = await runtime.beginTotpEnrollment(auth, { reauthenticationProof: proof.proof.reauthenticationProof }, { command: runtime.createOneTimeCommand() })
    if (!("transaction" in enrollment)) throw new Error("expected enrollment")
    await runtime.confirmTotpEnrollment(auth, { transactionRef: enrollment.transaction.transactionRef, code: "123456" }, { command: runtime.createOneTimeCommand() })
    await runtime.disableTotp(auth, { reauthenticationProof: proof.proof.reauthenticationProof, code: "234567" }, runtime.createCommand())
    await runtime.regenerateRecoveryCodes(auth, { reauthenticationProof: proof.proof.reauthenticationProof }, { command: runtime.createOneTimeCommand() })

    expect(requests.map(({ operationId }) => operationId)).toEqual([
      "reauthenticateIdentitySession", "beginTotpEnrollment", "confirmTotpEnrollment",
      "disableTotp", "regenerateRecoveryCodes",
    ])
    expect(requests[0]?.body).toEqual({ stage: "password", password: "correct horse battery staple", target })
    expect(requests[1]?.body).toEqual({ ceremonyAction: "begin", reauthenticationProof: "p".repeat(64) })
    expect(requests[3]?.security.receiptRecoveryCapability).toBeUndefined()
    expect(requests[4]?.body).toEqual({ recoveryAction: "regenerate", reauthenticationProof: "p".repeat(64) })
  })
})
