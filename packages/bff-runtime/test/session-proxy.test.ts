import { describe, expect, it, vi } from "vitest";

import type { SessionAccessGrant, SessionAccessManager } from "../src/session-access.js";
import {
  createSessionProxy,
  SessionProxyError,
  type SessionProxyRoute,
  type SessionProxyTransportPort,
} from "../src/session-proxy.js";
import type { SiteBootstrap } from "../src/site-binding.js";

const DIGEST = "a".repeat(64);
const bootstrap: SiteBootstrap = {
  productContextRef: "product-context-12345678",
  personalContextRef: "personal-context-12345678",
  siteProjectBindingRef: "binding-12345678",
  deploymentRef: "deployment-12345678",
  siteRef: "site-12345678",
  siteReleaseRef: "release-12345678",
  webArtifactDigest: DIGEST,
  runtimeEnvironment: "production",
  region: "us-east-1",
  productAudience: "kokoro.site.reference",
  sessionContractRevision: "session-browser-v3",
  policyEpoch: "4",
  revocationEpoch: "2",
  actor: {
    subjectRef: "subject-12345678",
    subjectGeneration: "7",
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
  enabledSurfaceIds: ["chat"],
  featurePolicyRevision: "feature-policy-12345678",
  modelOptionCatalogRef: "model-options-12345678",
  agentCatalogRef: "agent-catalog-12345678",
  localePolicy: { defaultLocale: "en-US", allowedLocales: ["en-US"] },
  issuedAt: "2026-07-28T12:00:00.000Z",
  expiresAt: "2026-07-28T12:01:00.000Z",
  cacheMaxAgeSeconds: 30,
};

const grant: SessionAccessGrant = {
  grantRef: "grant-12345678",
  credential: "g".repeat(64),
  binding: {
    productContextRef: bootstrap.productContextRef,
    siteProjectBindingRef: bootstrap.siteProjectBindingRef,
    deploymentRef: bootstrap.deploymentRef,
    siteRef: bootstrap.siteRef,
    siteReleaseRef: bootstrap.siteReleaseRef,
    webArtifactDigest: bootstrap.webArtifactDigest,
    runtimeEnvironment: bootstrap.runtimeEnvironment,
    region: bootstrap.region,
    sessionContractRevision: bootstrap.sessionContractRevision,
    projectRef: bootstrap.defaultProjectRef,
    subjectRef: bootstrap.actor.subjectRef,
    subjectGeneration: bootstrap.actor.subjectGeneration,
    identitySessionRef: "auth-session-12345678",
    policyEpoch: bootstrap.policyEpoch,
    revocationEpoch: bootstrap.revocationEpoch,
    issuedAt: "2026-07-28T12:00:00.000Z",
    expiresAt: "2026-07-28T12:01:00.000Z",
  },
  authorization: { purpose: "stream", audience: "session.stream" },
};

const access = { acquire: vi.fn(async () => grant) } as unknown as SessionAccessManager;
const verifier = { verify: vi.fn() };
const route: SessionProxyRoute<{ sessionRef: string }> = {
  operationId: "streamSessionEvents",
  method: "GET",
  purpose: "stream",
  replaySafety: "idempotent",
  responses: {
    200: {
      kind: "sse",
      maximumEmittedFrameBytes: 64 * 1024,
      maximumUpstreamChunkBytes: 256 * 1024,
      maximumBufferedBytes: 512 * 1024,
      createValidator: () => ({ push: (chunk) => [chunk], finish: () => [] }),
    },
    400: {
      kind: "json",
      contentTypes: ["application/problem+json"],
      maximumBytes: 64 * 1024,
      parse: (value) => value,
    },
  },
  parseInput: ({ pathParameters }) => pathParameters as { sessionRef: string },
};

function responseBinding() {
  return {
    grantRef: grant.grantRef,
    ...grant.binding,
    purpose: grant.authorization.purpose,
    audience: grant.authorization.audience,
  };
}

function transport(overrides: Partial<SessionProxyTransportPort> = {}): SessionProxyTransportPort {
  return {
    execute: async () => ({
      status: 200,
      headers: { "content-type": "text/event-stream", "set-cookie": "secret=value" },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("event: snapshot\ndata: {}\n\n"));
          controller.close();
        },
      }),
      binding: responseBinding(),
    }),
    ...overrides,
  };
}

describe("Session proxy", () => {
  it("requires request verification and rejects browser authority before transport", async () => {
    const execute = vi.fn<SessionProxyTransportPort["execute"]>();
    const proxy = createSessionProxy({
      bootstrap,
      access,
      transport: { execute },
      browserRequestVerifier: verifier,
    });
    await expect(proxy.execute({
      route,
      browser: {
        method: "GET",
        pathParameters: { sessionRef: "session-123", nested: { siteRef: "attacker-site" } },
      },
    })).rejects.toEqual(new SessionProxyError("BROWSER_AUTHORITY_FORBIDDEN"));
    expect(verifier.verify).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it("accepts typed JSON problems for an SSE operation and strips Set-Cookie", async () => {
    const proxy = createSessionProxy({
      bootstrap,
      access,
      browserRequestVerifier: verifier,
      transport: transport({
        execute: async () => ({
          status: 400,
          headers: { "content-type": "application/problem+json", "set-cookie": "secret=value" },
          body: new Response(JSON.stringify({ code: "CURSOR_INVALID" })).body,
          binding: responseBinding(),
        }),
      }),
    });
    const response = await proxy.execute({
      route,
      browser: { method: "GET", pathParameters: { sessionRef: "session-123" } },
    });
    expect(response.status).toBe(400);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(await response.json()).toEqual({ code: "CURSOR_INVALID" });
  });

  it("cancels a response whose authenticated deployment binding differs", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const proxy = createSessionProxy({
      bootstrap,
      access,
      browserRequestVerifier: verifier,
      transport: transport({
        execute: async () => ({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body,
          binding: { ...responseBinding(), deploymentRef: "other-deployment" },
        }),
      }),
    });
    await expect(proxy.execute({
      route,
      browser: { method: "GET", pathParameters: { sessionRef: "session-123" } },
    })).rejects.toMatchObject({ code: "UPSTREAM_BINDING_MISMATCH" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });
});
