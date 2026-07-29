import { describe, expect, it, vi } from "vitest";

import type { SessionAccessGrant, SessionAccessManager } from "../src/session-access.js";
import {
  createOriginCsrfBrowserRequestVerifier,
  createSessionProxy,
  SessionProxyError,
  type SessionProxyMethod,
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
  modelOptionCatalogs: [{
    surfaceId: "chat",
    catalogRevisionRef: "chat-catalog-12345678",
    defaultModelOptionRevisionRef: "model-option-12345678",
    options: [{
      modelOptionRevisionRef: "model-option-12345678", optionKey: "chat.standard", label: "Standard",
      inputModalities: ["text"], outputModalities: ["text"], supportedEfforts: [], badges: [],
      availability: "available",
    }],
    publishedAt: "2026-07-28T12:00:00.000Z",
  }],
  agentCatalogRef: "agent-catalog-12345678",
  localePolicy: { defaultLocale: "en-US", allowedLocales: ["en-US"] },
  issuedAt: "2026-07-28T12:00:00.000Z",
  expiresAt: "2026-07-28T12:01:00.000Z",
  cacheMaxAgeSeconds: 30,
};

const grant: SessionAccessGrant = {
  grantRef: "grant-12345678",
  credential: "headerheader.payloadpayload.signaturesignature",
  binding: {
    authorizationEpoch: "1",
    credentialEpoch: "1",
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
    identitySessionEpoch: "1",
    issuer: "https://platform.example.test",
    keyRevision: "key-1",
    membershipEpoch: "1",
    notBefore: "2026-07-28T12:00:00.000Z",
    policyEpoch: bootstrap.policyEpoch,
    restrictionEpoch: "1",
    revocationEpoch: bootstrap.revocationEpoch,
    siteSecurityEpoch: "1",
    resource: { kind: "session", sessionRef: "session-12345678" },
    issuedAt: "2026-07-28T12:00:00.000Z",
    expiresAt: "2026-07-28T12:01:00.000Z",
  },
  authorization: { purpose: "stream", audience: "session.stream" },
};

const access = { acquire: vi.fn(async () => grant) } as unknown as SessionAccessManager;
const BROWSER_HEADERS = {
  origin: "https://chat.example.test",
  "sec-fetch-site": "same-origin",
};
const verifier = {
  verify: vi.fn((input: { readonly operationId: string; readonly method: SessionProxyMethod }) => ({
    kind: "same-origin-browser" as const,
    operationId: input.operationId,
    method: input.method,
    origin: BROWSER_HEADERS.origin,
  })),
};
const route: SessionProxyRoute<{ sessionRef: string }> = {
  operationId: "streamSessionEvents",
  method: "GET",
  purpose: "stream",
  replaySafety: "idempotent",
  success: {
    status: 200,
    response: {
      kind: "sse",
      maximumEmittedFrameBytes: 64 * 1024,
      maximumUpstreamChunkBytes: 256 * 1024,
      maximumBufferedBytes: 512 * 1024,
      createValidator: () => ({ push: (chunk) => [chunk], finish: () => [] }),
    },
  },
  problem: {
    kind: "json",
    contentTypes: ["application/problem+json"],
    maximumBytes: 64 * 1024,
    parse: (value) => value,
  },
  resource: ({ sessionRef }) => ({ kind: "session", sessionRef }),
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
  it("requires same-origin browser proof even for read and stream operations", async () => {
    const csrf = { verify: vi.fn(async () => true) };
    const browserRequestVerifier = createOriginCsrfBrowserRequestVerifier({
      runtimeEnvironment: "production",
      allowedOrigins: ["https://chat.example.test"],
      csrf,
    });

    await expect(browserRequestVerifier.verify({
      operationId: "snapshot",
      method: "GET",
      headers: {},
    })).rejects.toEqual(new SessionProxyError("BROWSER_REQUEST_UNVERIFIED"));
    await expect(browserRequestVerifier.verify({
      operationId: "stream",
      method: "GET",
      headers: { origin: "https://chat.example.test", "sec-fetch-site": "cross-site" },
    })).rejects.toEqual(new SessionProxyError("BROWSER_REQUEST_UNVERIFIED"));
    await expect(browserRequestVerifier.verify({
      operationId: "snapshot",
      method: "GET",
      headers: { origin: "https://chat.example.test", "sec-fetch-site": "same-origin" },
    })).resolves.toMatchObject({ kind: "same-origin-browser" });
    expect(csrf.verify).not.toHaveBeenCalled();
  });

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
        headers: BROWSER_HEADERS,
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
      browser: { method: "GET", headers: BROWSER_HEADERS, pathParameters: { sessionRef: "session-123" } },
    });
    expect(response.status).toBe(400);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(response.headers.get("content-type")).toBe("application/problem+json; charset=utf-8");
    expect(await response.json()).toEqual({ code: "CURSOR_INVALID" });
  });

  it("rejects browser credential authority before route parsing", async () => {
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
        headers: BROWSER_HEADERS,
        pathParameters: { sessionRef: "session-123" },
        query: { credential: "browser-owned-secret" },
      },
    })).rejects.toEqual(new SessionProxyError("BROWSER_AUTHORITY_FORBIDDEN"));
    expect(execute).not.toHaveBeenCalled();
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
      browser: { method: "GET", headers: BROWSER_HEADERS, pathParameters: { sessionRef: "session-123" } },
    })).rejects.toMatchObject({ code: "UPSTREAM_BINDING_MISMATCH" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
  });

  it("disables transformation and intermediary buffering for validated SSE", async () => {
    const proxy = createSessionProxy({ bootstrap, access, transport: transport(), browserRequestVerifier: verifier });
    const response = await proxy.execute({
      route,
      browser: { method: "GET", headers: BROWSER_HEADERS, pathParameters: { sessionRef: "session-123" } },
    });
    expect(response.headers.get("cache-control")).toBe("no-store, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    await response.body?.cancel();
  });

  it("keeps upstream validation pull-driven when the browser applies backpressure", async () => {
    let producer: ReadableStreamDefaultController<Uint8Array> | undefined;
    const push = vi.fn((chunk: Uint8Array) => [chunk]);
    const pullRoute: SessionProxyRoute<{ sessionRef: string }> = {
      ...route,
      success: {
        ...route.success,
        response: {
          ...route.success.response as Extract<typeof route.success.response, { kind: "sse" }>,
          createValidator: () => ({ push, finish: () => [] }),
        },
      },
    };
    const proxy = createSessionProxy({
      bootstrap,
      access,
      browserRequestVerifier: verifier,
      transport: transport({
        execute: async () => ({
          status: 200,
          headers: { "content-type": "text/event-stream" },
          body: new ReadableStream<Uint8Array>({ start(controller) { producer = controller; } }),
          binding: responseBinding(),
        }),
      }),
    });
    const response = await proxy.execute({
      route: pullRoute,
      browser: { method: "GET", headers: BROWSER_HEADERS, pathParameters: { sessionRef: "session-123" } },
    });
    const frame = new TextEncoder().encode("event: snapshot\ndata: {}\n\n");
    producer?.enqueue(frame);
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    producer?.enqueue(frame);
    producer?.enqueue(frame);
    await Promise.resolve();
    expect(push).toHaveBeenCalledTimes(1);
    await response.body?.cancel();
  });

  it("propagates downstream cancellation to the upstream reader and abort signal", async () => {
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    const proxy = createSessionProxy({
      bootstrap,
      access,
      browserRequestVerifier: verifier,
      transport: transport({
        execute: async (request) => {
          signal = request.signal;
          return {
            status: 200,
            headers: { "content-type": "text/event-stream" },
            body: new ReadableStream<Uint8Array>({ cancel }),
            binding: responseBinding(),
          };
        },
      }),
    });
    const response = await proxy.execute({
      route,
      browser: { method: "GET", headers: BROWSER_HEADERS, pathParameters: { sessionRef: "session-123" } },
    });
    await response.body?.cancel("browser disconnected");
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledWith("browser disconnected");
  });

  it("fails closed, cancels, and aborts when an upstream chunk exceeds its bound", async () => {
    const cancel = vi.fn();
    let signal: AbortSignal | undefined;
    const boundedRoute: SessionProxyRoute<{ sessionRef: string }> = {
      ...route,
      success: {
        ...route.success,
        response: {
          kind: "sse",
          maximumEmittedFrameBytes: 4,
          maximumUpstreamChunkBytes: 4,
          maximumBufferedBytes: 8,
          createValidator: () => ({ push: (chunk) => [chunk], finish: () => [] }),
        },
      },
    };
    const proxy = createSessionProxy({
      bootstrap,
      access,
      browserRequestVerifier: verifier,
      transport: transport({
        execute: async (request) => {
          signal = request.signal;
          return {
            status: 200,
            headers: { "content-type": "text/event-stream" },
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(5));
              },
              cancel,
            }),
            binding: responseBinding(),
          };
        },
      }),
    });
    const response = await proxy.execute({
      route: boundedRoute,
      browser: { method: "GET", headers: BROWSER_HEADERS, pathParameters: { sessionRef: "session-123" } },
    });
    await expect(response.body?.getReader().read()).rejects.toMatchObject({ code: "UPSTREAM_PROTOCOL_ERROR" });
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    expect(signal?.aborted).toBe(true);
  });
});
