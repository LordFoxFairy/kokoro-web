import { describe, expect, it, vi } from "vitest";

import {
  bootstrapSiteRuntime,
  bootstrapSiteRuntimeFromOpaqueSession,
  loadSiteDeploymentBinding,
  ProductContextManager,
  publicSiteBootstrap,
  SiteBindingError,
  type AuthSession,
} from "../src/site-binding.js";
import { SessionAccessManager, type SessionGrantResource } from "../src/session-access.js";

const DIGEST = "a".repeat(64);
let now = new Date("2026-07-28T12:00:00.000Z");

const binding = loadSiteDeploymentBinding({
  runtimeEnvironment: "production",
  siteProjectBindingRef: "binding-12345678",
  deploymentRef: "deployment-12345678",
  siteReleaseRef: "release-12345678",
  webArtifactDigest: DIGEST,
  workloadCredential: "w".repeat(64),
  sessionContractRevision: "session-browser-v3",
  region: "us-east-1",
  productAudience: "kokoro.site.reference",
});

const authSession: AuthSession = {
  sessionRef: "auth-session-12345678",
  sessionCredential: "s".repeat(64),
  subjectRef: "subject-12345678",
  subjectGeneration: "7",
  expiresAt: "2026-07-28T12:10:00.000Z",
};

function productContext(commandId: string) {
  return {
    receipt: {
      commandId,
      committedAt: now.toISOString(),
      receiptRef: `receipt-${commandId}`,
      requestDigest: "b".repeat(64),
      state: "committed",
    },
    context: {
      productContextRef: `product-context-${commandId}`,
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
      enabledSurfaceIds: ["chat"],
      featurePolicyRevision: "feature-policy-12345678",
      modelOptionCatalogRef: "model-options-12345678",
      modelOptionCatalogs: [chatCatalog()],
      agentCatalogRef: "agent-catalog-12345678",
      localePolicy: { defaultLocale: "en-US", allowedLocales: ["en-US"] },
      cacheMaxAgeSeconds: 10,
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    },
  };
}

function chatCatalog() {
  return {
    surfaceId: "chat",
    catalogRevisionRef: "chat-catalog-12345678",
    defaultModelOptionRevisionRef: "model-option-12345678",
    options: [{
      modelOptionRevisionRef: "model-option-12345678",
      optionKey: "chat.standard",
      label: "Standard",
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportedEfforts: [],
      badges: ["standard"],
      availability: "available" as const,
    }],
    publishedAt: now.toISOString(),
  };
}

function createProductContexts() {
  let sequence = 0;
  const exchange = vi.fn(async (request: { command: { commandId: string } }) => (
    productContext(request.command.commandId)
  ));
  const manager = new ProductContextManager({
    binding,
    authority: { exchangeProductContext: exchange },
    commandFactory: {
      create: () => {
        sequence += 1;
        const commandId = sequence.toString(16).padStart(32, "0");
        return { commandRef: `refresh-${sequence}`, commandId, idempotencyKey: `idem-${sequence}`.padEnd(16, "x") };
      },
    },
    now: () => now,
  });
  return { exchange, manager };
}

describe("Product and Personal context composition", () => {
  it("accepts a registered staging deployment binding", () => {
    const staging = loadSiteDeploymentBinding({
      runtimeEnvironment: "staging",
      siteProjectBindingRef: binding.siteProjectBindingRef,
      deploymentRef: binding.deploymentRef,
      siteReleaseRef: binding.siteReleaseRef,
      webArtifactDigest: binding.webArtifactDigest,
      workloadCredential: binding.workloadCredential,
      sessionContractRevision: binding.sessionContractRevision,
      region: binding.region,
      productAudience: binding.productAudience,
    });

    expect(staging.runtimeEnvironment).toBe("staging");
  });

  it("forbids local unsafe production binding", () => {
    expect(() => loadSiteDeploymentBinding({
      runtimeEnvironment: binding.runtimeEnvironment,
      siteProjectBindingRef: binding.siteProjectBindingRef,
      deploymentRef: binding.deploymentRef,
      siteReleaseRef: binding.siteReleaseRef,
      webArtifactDigest: binding.webArtifactDigest,
      workloadCredential: binding.workloadCredential,
      sessionContractRevision: binding.sessionContractRevision,
      region: binding.region,
      productAudience: binding.productAudience,
      localUnsafeSiteBinding: true,
    })).toThrowError(
      new SiteBindingError("LOCAL_UNSAFE_PRODUCTION_FORBIDDEN"),
    );
  });

  it("refreshes at cacheMaxAge with a new command identity", async () => {
    now = new Date("2026-07-28T12:00:00.000Z");
    const { exchange, manager } = createProductContexts();
    await manager.acquire();
    await manager.acquire();
    expect(exchange).toHaveBeenCalledTimes(1);
    now = new Date("2026-07-28T12:00:11.000Z");
    await manager.acquire();
    expect(exchange).toHaveBeenCalledTimes(2);
    expect(exchange.mock.calls[0]?.[0].command.commandId).not.toBe(
      exchange.mock.calls[1]?.[0].command.commandId,
    );
  });

  it("deep-freezes the composed bootstrap and removes browser authority", async () => {
    now = new Date("2026-07-28T12:00:00.000Z");
    const { manager } = createProductContexts();
    const bootstrap = await bootstrapSiteRuntime({
      productContexts: manager,
      authSession,
      now: () => now,
      personalAuthority: {
        getPersonalContext: async ({ productContextRef }) => ({
          personalContextRef: "personal-context-12345678",
          productContextRef,
          actor: {
            subjectRef: authSession.subjectRef,
            subjectGeneration: authSession.subjectGeneration,
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
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 50_000).toISOString(),
        }),
      },
    });
    expect(Object.isFrozen(bootstrap.projects)).toBe(true);
    expect(Object.isFrozen(bootstrap.localePolicy.allowedLocales)).toBe(true);
    const publicView = publicSiteBootstrap(bootstrap);
    expect(publicView.actor).toEqual({ displayName: "Example User", avatarUrl: null });
    expect(publicView).not.toHaveProperty("siteRef");
    expect(publicView.actor).not.toHaveProperty("subjectGeneration");

    const issueSessionAccessGrant = vi.fn(async (request: {
      productContextRef: string;
      projectRef: string;
      purpose: "read" | "write" | "control" | "stream";
      resource: SessionGrantResource;
      authSessionRef: string;
    }) => ({
      grant: {
        grantRef: "grant-12345678",
        credential: "headerheader.payloadpayload.signaturesignature",
        binding: {
          authorizationEpoch: "1",
          authorizationStreamSequence: "11",
          credentialEpoch: "1",
          productContextRef: request.productContextRef,
          siteProjectBindingRef: bootstrap.siteProjectBindingRef,
          deploymentRef: bootstrap.deploymentRef,
          siteRef: bootstrap.siteRef,
          siteReleaseRef: bootstrap.siteReleaseRef,
          webArtifactDigest: bootstrap.webArtifactDigest,
          runtimeEnvironment: bootstrap.runtimeEnvironment,
          region: bootstrap.region,
          sessionContractRevision: bootstrap.sessionContractRevision,
          projectRef: request.projectRef,
          subjectRef: authSession.subjectRef,
          subjectGeneration: authSession.subjectGeneration,
          identitySessionRef: request.authSessionRef,
          identitySessionEpoch: "1",
          issuer: "https://platform.example.test",
          keyRevision: "key-1",
          membershipEpoch: "1",
          notBefore: now.toISOString(),
          policyEpoch: bootstrap.policyEpoch,
          restrictionEpoch: "1",
          revocationEpoch: bootstrap.revocationEpoch,
          siteSecurityEpoch: "1",
          resource: request.resource,
          issuedAt: now.toISOString(),
          expiresAt: new Date(now.getTime() + 30_000).toISOString(),
        },
        authorization: {
          purpose: request.purpose,
          audience: `session.${request.purpose}`,
        },
      },
    }));
    const access = new SessionAccessManager({
      bootstrap,
      authSession,
      authority: { issueSessionAccessGrant },
      now: () => now,
      refreshSkewMs: 1_000,
    });
    await access.acquire({ purpose: "write", resource: { kind: "project" } });
    expect(issueSessionAccessGrant).toHaveBeenCalledWith(expect.objectContaining({
      productContextRef: bootstrap.productContextRef,
      projectRef: bootstrap.defaultProjectRef,
      purpose: "write",
      resource: { kind: "project" },
    }));
    expect(issueSessionAccessGrant.mock.calls[0]?.[0]).not.toHaveProperty("siteRef");
  });

  it("derives actor authority from Platform instead of requiring claims in the sealed Web token", async () => {
    now = new Date("2026-07-28T12:00:00.000Z");
    const { manager } = createProductContexts();
    const resolved = await bootstrapSiteRuntimeFromOpaqueSession({
      productContexts: manager,
      authSession: {
        sessionRef: authSession.sessionRef,
        sessionCredential: authSession.sessionCredential,
        expiresAt: authSession.expiresAt,
      },
      now: () => now,
      personalAuthority: {
        getPersonalContext: async ({ productContextRef, authSessionCredential }) => {
          expect(authSessionCredential).toBe(authSession.sessionCredential);
          return {
            personalContextRef: "personal-context-opaque-12345678",
            productContextRef,
            actor: {
              subjectRef: authSession.subjectRef,
              subjectGeneration: authSession.subjectGeneration,
              state: "active",
              displayName: "Opaque User",
              avatarUrl: null,
            },
            projects: [{
              projectRef: "project-opaque-12345678",
              workspaceRef: "workspace-opaque-12345678",
              executionSpaceRef: "execution-space-opaque-12345678",
              displayName: "Personal",
              membershipRevision: "membership-opaque-12345678",
            }],
            defaultProjectRef: "project-opaque-12345678",
            contextRevision: "personal-revision-opaque-12345678",
            issuedAt: now.toISOString(),
            expiresAt: new Date(now.getTime() + 50_000).toISOString(),
          };
        },
      },
    });
    expect(resolved.authSession).toEqual(authSession);
    expect(publicSiteBootstrap(resolved.bootstrap).actor).toEqual({
      displayName: "Opaque User",
      avatarUrl: null,
    });
  });
});
