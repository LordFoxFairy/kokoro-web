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
})
