import { describe, expect, it } from "vitest"

import type { SiteDeploymentBinding } from "@kokoro/bff-runtime"
import type { PlatformPublicRequest, PlatformPublicTransport } from "@kokoro/site-client/server"
import type { NodeSiteRuntimeProvider } from "@kokoro/site-runtime-node"

import { createSiteBffRuntime } from "../src/index.js"

const observedAt = Date.now()
const now = new Date(observedAt - 1_000).toISOString()
const later = new Date(observedAt + 120_000).toISOString()
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
const auth = {
  sessionRef: "identity-session-12345678",
  sessionCredential: "s".repeat(64),
  expiresAt: later,
}

function commandReceipt(request: PlatformPublicRequest<never>, operation: "create_asset_upload_intent" | "complete_asset_upload") {
  return {
    commandId: request.headers["X-Kokoro-Command-Id"],
    operation,
    receiptRef: `receipt-${operation}`,
    receivedAt: now,
    state: "succeeded",
    updatedAt: now,
  }
}

function upload(stage: "uploading" | "ready" = "uploading") {
  return {
    clientMediaType: "image/png",
    expectedSize: "1024",
    expectedVersion: "1",
    intentRef: "intent-12345678",
    projectRef: "authoritative-project-12345678",
    purpose: "chat.attachment",
    retryAfter: null,
    retryClass: "never",
    safeDisplayName: "picture.png",
    safeReasonCode: null,
    sessionRef: "upload-session-12345678",
    stage,
    terminal: stage === "ready",
    trustedGrant: stage === "ready" ? {
      assetGrantRef: "grant-12345678",
      assetRef: "asset-12345678",
      assetVersionRef: "asset-version-12345678",
      detectedMediaType: "image/png",
      eligibilityEpoch: "1",
      projectRef: "authoritative-project-12345678",
      purpose: "chat.attachment",
      size: "1024",
      state: "ready",
      subjectGeneration: "1",
    } : null,
  }
}

describe("Site Asset owner boundary", () => {
  it("derives the project from authenticated Site context for every upload operation", async () => {
    const requests: PlatformPublicRequest<never>[] = []
    const transport: PlatformPublicTransport = { async execute(request) {
      requests.push(request as PlatformPublicRequest<never>)
      switch (request.operationId) {
        case "exchangeProductContext": return { status: 200, body: {
          receipt: { commandId: request.headers["X-Kokoro-Command-Id"], committedAt: now, receiptRef: "receipt-context", requestDigest: "b".repeat(64), state: "committed" },
          context: {
            agentCatalogRef: "agent-catalog-12345678", audience: binding.productAudience, cacheMaxAgeSeconds: 30,
            deploymentRef: binding.deploymentRef, enabledSurfaceIds: ["asset"], expiresAt: later,
            featurePolicyRevision: "feature-policy-12345678", issuedAt: now,
            localePolicy: { defaultLocale: "en-US", allowedLocales: ["en-US"] },
            modelOptionCatalogRef: "models-12345678", modelOptionCatalogs: [], policyEpoch: "1",
            productContextRef: "product-context-12345678", region: binding.region, revocationEpoch: "1",
            runtimeEnvironment: "production", sessionContractRevision: binding.sessionContractRevision,
            siteProjectBindingRef: binding.siteProjectBindingRef, siteRef: "site-12345678",
            siteReleaseRef: binding.siteReleaseRef, webArtifactDigest: binding.webArtifactDigest,
          },
        } }
        case "getPersonalContext": return { status: 200, body: {
          actor: { avatarUrl: null, displayName: "Owner", state: "active", subjectGeneration: "1", subjectRef: "subject-12345678" },
          contextRevision: "personal-revision-12345678", defaultProjectRef: "authoritative-project-12345678",
          expiresAt: later, issuedAt: now, personalContextRef: "personal-context-12345678",
          productContextRef: "product-context-12345678", projects: [{ displayName: "Personal",
            executionSpaceRef: "execution-space-12345678", membershipRevision: "membership-12345678",
            projectRef: "authoritative-project-12345678", workspaceRef: "workspace-12345678" }],
        } }
        case "createAssetUploadIntent": return { status: 201, body: {
          capability: { capabilityEpoch: "1", credential: "c".repeat(64), expiresAt: later,
            maximumPartBytes: "8388608", minimumPartBytes: "5242880", protocolRevision: "s3-multipart-v1",
            uploadEndpoint: "https://uploads.example" },
          receipt: commandReceipt(request as PlatformPublicRequest<never>, "create_asset_upload_intent"), upload: upload(),
        } }
        case "completeAssetUpload": return { status: 202, body: {
          receipt: commandReceipt(request as PlatformPublicRequest<never>, "complete_asset_upload"), upload: upload(),
        } }
        case "getAssetUploadStatus": return { status: 200, body: { upload: upload("ready") } }
        case "recoverAssetUploadCommand": return { status: 200, body: {
          receipt: commandReceipt({ ...request, headers: { ...request.headers, "X-Kokoro-Command-Id": request.path.split("/").at(-1) ?? "" } } as PlatformPublicRequest<never>, "complete_asset_upload"),
          upload: upload(),
        } }
        default: throw new Error(`unexpected operation: ${request.operationId}`)
      }
    } }
    const provider = {
      platformTransport: () => transport,
      sessionHttp: () => ({ send: async () => { throw new Error("not used") } }),
      platformCsrfToken: () => "p".repeat(64), issueBrowserCsrf: () => "browser-csrf",
      verifyBrowserCsrf: () => true, close: () => undefined,
    } satisfies NodeSiteRuntimeProvider
    const runtime = createSiteBffRuntime({ binding, publicOrigin: "https://site.example", provider })
    const createCommand = { commandId: "1".repeat(32), idempotencyKey: "2".repeat(48) }
    const completeCommand = { commandId: "3".repeat(32), idempotencyKey: "4".repeat(48) }

    const created = await runtime.createAssetUploadIntent(auth, {
      clientMediaType: "image/png", expectedChecksumSha256: "e".repeat(64), expectedSize: "1024",
      filename: "picture.png", purpose: "chat.attachment",
    }, createCommand)
    await runtime.completeAssetUpload(auth, created.upload.intentRef, {
      expectedVersion: created.upload.expectedVersion, sessionRef: created.upload.sessionRef,
    }, completeCommand)
    const ready = await runtime.getAssetUploadStatus(auth, created.upload.intentRef)
    await runtime.recoverAssetUploadCommand(auth, completeCommand.commandId)

    expect(ready.upload.trustedGrant).toEqual(expect.objectContaining({ assetGrantRef: "grant-12345678" }))
    const assetRequests = requests.filter(({ operationId }) => operationId.includes("AssetUpload"))
    expect(assetRequests).toHaveLength(4)
    expect(assetRequests.map((request) => request.path)).toEqual([
      "/v1/projects/authoritative-project-12345678/asset-upload-intents",
      "/v1/projects/authoritative-project-12345678/asset-upload-intents/intent-12345678:complete",
      "/v1/projects/authoritative-project-12345678/asset-upload-intents/intent-12345678",
      `/v1/projects/authoritative-project-12345678/asset-upload-commands/${completeCommand.commandId}`,
    ])
    expect(JSON.stringify(assetRequests)).not.toContain("provider")
    expect(JSON.stringify(assetRequests)).not.toContain("bucket")
  })
})
