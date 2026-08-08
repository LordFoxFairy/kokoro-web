import { describe, expect, it, vi } from "vitest";

import {
  SessionAccessError,
  SessionAccessManager,
  type SessionGrantResource,
} from "../src/session-access.js";
import type { AuthSession, SiteBootstrap } from "../src/site-binding.js";

const NOW = new Date("2026-07-28T12:00:00.000Z");
const authSession: AuthSession = {
  sessionRef: "identity-session-1",
  sessionCredential: "identity-credential-that-never-leaves-the-server",
  subjectRef: "subject-1",
  subjectGeneration: "7",
  expiresAt: "2026-07-28T12:10:00.000Z",
};
const bootstrap: SiteBootstrap = {
  productContextRef: "product-context-1",
  personalContextRef: "personal-context-1",
  siteProjectBindingRef: "site-project-binding-1",
  deploymentRef: "deployment-1",
  siteRef: "site-1",
  siteReleaseRef: "release-1",
  webArtifactDigest: "a".repeat(64),
  runtimeEnvironment: "production",
  region: "us-east-1",
  productAudience: "kokoro.site.reference",
  sessionContractRevision: "session-browser-v3",
  policyEpoch: "4",
  revocationEpoch: "2",
  actor: { subjectRef: "subject-1", subjectGeneration: "7", state: "active", displayName: "User", avatarUrl: null },
  projects: [{
    projectRef: "project-1",
    workspaceRef: "workspace-1",
    executionSpaceRef: "execution-1",
    displayName: "Personal",
    membershipRevision: "membership-1",
  }],
  defaultProjectRef: "project-1",
  enabledSurfaceIds: ["chat"],
  featurePolicyRevision: "feature-1",
  modelOptionCatalogRef: "models-1",
  modelOptionCatalogs: [{
    surfaceId: "chat",
    catalogRevisionRef: "chat-catalog-1",
    defaultModelOptionRevisionRef: "model-option-1",
    options: [{
      modelOptionRevisionRef: "model-option-1",
      optionKey: "chat.standard",
      label: "Standard",
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportedEfforts: [],
      badges: [],
      availability: "available",
    }],
    publishedAt: NOW.toISOString(),
  }],
  agentCatalogRef: "agents-1",
  localePolicy: { defaultLocale: "en-US", allowedLocales: ["en-US"] },
  issuedAt: NOW.toISOString(),
  expiresAt: "2026-07-28T12:10:00.000Z",
  cacheMaxAgeSeconds: 30,
};

function authority(overrides: Readonly<Record<string, unknown>> = {}) {
  return vi.fn(async (request: {
    productContextRef: string;
    projectRef: string;
    purpose: "read" | "write" | "control" | "stream";
    resource: SessionGrantResource;
    authSessionRef: string;
  }) => ({
    grant: {
      grantRef: `grant-${JSON.stringify(request.resource)}`,
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
        notBefore: NOW.toISOString(),
        policyEpoch: bootstrap.policyEpoch,
        restrictionEpoch: "1",
        revocationEpoch: bootstrap.revocationEpoch,
        siteSecurityEpoch: "1",
        resource: request.resource,
        issuedAt: NOW.toISOString(),
        expiresAt: "2026-07-28T12:04:00.000Z",
        ...overrides,
      },
      authorization: { purpose: request.purpose, audience: `session.${request.purpose}` },
    },
  }));
}

function manager(adapter = authority()) {
  return {
    adapter,
    access: new SessionAccessManager({
      bootstrap,
      authSession,
      authority: { issueSessionAccessGrant: adapter },
      now: () => NOW,
    }),
  };
}

describe("Session access grant boundary", () => {
  it("accepts a grant bound to the staging runtime environment", async () => {
    const stagingBootstrap = { ...bootstrap, runtimeEnvironment: "staging" as const };
    const adapter = authority({ runtimeEnvironment: "staging" });
    const access = new SessionAccessManager({
      bootstrap: stagingBootstrap,
      authSession,
      authority: { issueSessionAccessGrant: adapter },
      now: () => NOW,
    });

    await expect(access.acquire({ purpose: "read", resource: { kind: "project" } }))
      .resolves.toMatchObject({ binding: { runtimeEnvironment: "staging" } });
  });

  it("caches by the exact project/session/run resource", async () => {
    const { access, adapter } = manager();
    await access.acquire({ purpose: "read", resource: { kind: "project" } });
    await access.acquire({ purpose: "read", resource: { kind: "project" } });
    await access.acquire({ purpose: "read", resource: { kind: "session", sessionRef: "session-1" } });
    await access.acquire({ purpose: "read", resource: { kind: "session", sessionRef: "session-2" } });
    await access.acquire({
      purpose: "read",
      resource: { kind: "run", sessionRef: "session-1", runRef: "run-1" },
    });
    expect(adapter).toHaveBeenCalledTimes(4);
  });

  it("rejects a grant that is not a compact JWS", async () => {
    const adapter = authority();
    adapter.mockImplementationOnce(async (request) => {
      const response = await authority()(request);
      return { ...response, grant: { ...response.grant, credential: "g".repeat(64) } };
    });
    await expect(manager(adapter).access.acquire({ purpose: "read", resource: { kind: "project" } }))
      .rejects.toEqual(new SessionAccessError("GRANT_INVALID"));
  });

  it.each(["0", "18446744073709551616"])("rejects non-positive or overflowing uint64 epoch %s", async (epoch) => {
    const { access } = manager(authority({ authorizationEpoch: epoch }));
    await expect(access.acquire({ purpose: "read", resource: { kind: "project" } }))
      .rejects.toEqual(new SessionAccessError("GRANT_INVALID"));
  });

  it("requires the committed authorization stream sequence bound by Platform", async () => {
    const adapter = authority();
    adapter.mockImplementationOnce(async (request) => {
      const response = await authority()(request);
      Reflect.deleteProperty(response.grant.binding, "authorizationStreamSequence");
      return response;
    });
    await expect(manager(adapter).access.acquire({ purpose: "read", resource: { kind: "project" } }))
      .rejects.toEqual(new SessionAccessError("GRANT_INVALID"));
  });

  it("hard-caps grant TTL configuration at five minutes", () => {
    expect(() => new SessionAccessManager({
      bootstrap,
      authSession,
      authority: { issueSessionAccessGrant: authority() },
      maximumGrantLifetimeMs: 300_001,
    })).toThrow(new SessionAccessError("GRANT_LIFETIME_INVALID"));
  });
});
