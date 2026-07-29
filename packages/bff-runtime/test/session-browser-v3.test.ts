import { describe, expect, it, vi } from "vitest";

import type { SessionAccessGrant, SessionAccessManager } from "../src/session-access.js";
import {
  createSessionBrowserV3Proxy,
  createSessionBrowserV3SseFrameValidator,
  createSessionBrowserV3Transport,
  matchSessionBrowserV3Request,
  SESSION_BROWSER_V3_OPERATION_IDS,
  SESSION_BROWSER_V3_ROUTES,
  type AuthenticatedSessionBrowserV3HttpPort,
} from "../src/session-browser-v3.js";
import { SessionProxyError } from "../src/session-proxy.js";
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
  expiresAt: "2026-07-28T12:05:00.000Z",
  cacheMaxAgeSeconds: 30,
};

function grant(purpose: "read" | "write" | "control" | "stream"): SessionAccessGrant {
  return {
    grantRef: `grant-${purpose}-12345678`,
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
      resource: { kind: "project" },
      issuedAt: "2026-07-28T12:00:00.000Z",
      expiresAt: "2026-07-28T12:01:00.000Z",
    },
    authorization: {
      purpose,
      audience: `session.${purpose}`,
    } as SessionAccessGrant["authorization"],
  };
}

function authenticatedBinding(accessGrant: SessionAccessGrant) {
  return {
    grantRef: accessGrant.grantRef,
    ...accessGrant.binding,
    purpose: accessGrant.authorization.purpose,
    audience: accessGrant.authorization.audience,
  };
}

function sseValidator(initialCursor = "signed.cursor.0", sessionId = "session-12345678") {
  return createSessionBrowserV3SseFrameValidator({ initialCursor, sessionId });
}

function browserEvent(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    kind: "branch.activated",
    event_id: "event-12345678",
    cursor: "signed.cursor.1",
    session_id: "session-12345678",
    stream_epoch: "epoch-12345678",
    durable_seq: "1",
    projection_version: 1,
    schema_revision: 3,
    recorded_at: "2026-07-28T12:00:00.000Z",
    payload: {
      branch_id: "branch-12345678",
      session_version: 1,
    },
    ...overrides,
  };
}

function sseFrame(value: unknown, options: { readonly id?: string; readonly event?: string } = {}): Uint8Array {
  const event = options.event ?? (typeof value === "object" && value !== null && "kind" in value
    ? String(value.kind)
    : "message");
  const id = options.id === undefined ? "" : `id: ${options.id}\n`;
  return new TextEncoder().encode(`${id}event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

describe("Session browser v3 operation authority", () => {
  it("matches only exact generated method/path pairs", () => {
    expect(matchSessionBrowserV3Request({
      method: "POST",
      pathname: "/v1/sessions/session-1/runs/run-1:cancel",
      searchParams: new URLSearchParams(),
    })).toEqual({
      operationId: "cancelRun",
      pathParameters: { session_id: "session-1", run_id: "run-1" },
      query: {},
    });
    expect(() => matchSessionBrowserV3Request({
      method: "DELETE",
      pathname: "/v1/arbitrary/internal/path",
      searchParams: new URLSearchParams(),
    })).toThrow(new SessionProxyError("REQUEST_INVALID"));
  });

  it("publishes exactly the generated browser operation surface", () => {
    expect(SESSION_BROWSER_V3_OPERATION_IDS).toEqual([
      "createSession",
      "listSessions",
      "snapshot",
      "stream",
      "submitMessage",
      "editMessage",
      "regenerateMessage",
      "forkBranch",
      "activateBranch",
      "cancelRun",
      "decideAction",
      "decidePlan",
      "getCommandReceipt",
      "updateSession",
      "archiveSession",
      "restoreSession",
      "trashSession",
      "putPreference",
      "listFolders",
      "createFolder",
      "updateFolder",
      "deleteFolder",
    ]);
    expect(SESSION_BROWSER_V3_ROUTES.putPreference.method).toBe("PUT");
    expect(SESSION_BROWSER_V3_ROUTES.cancelRun.purpose).toBe("control");
    expect(SESSION_BROWSER_V3_ROUTES.stream.purpose).toBe("stream");
    expect(SESSION_BROWSER_V3_ROUTES.getCommandReceipt.purpose).toBe("read");
    expect(SESSION_BROWSER_V3_ROUTES.submitMessage.purpose).toBe("write");
  });

  it("normalizes an omitted stream query but rejects numeric replay cursors", () => {
    expect(SESSION_BROWSER_V3_ROUTES.stream.parseInput({
      pathParameters: { session_id: "session-12345678" },
      query: undefined,
      body: undefined,
    })).toEqual({
      pathParameters: { session_id: "session-12345678" },
      query: {},
      bodyJson: null,
    });

    expect(() => SESSION_BROWSER_V3_ROUTES.stream.parseInput({
      pathParameters: { session_id: "session-12345678" },
      query: { after: "7" },
      body: undefined,
    })).toThrowError(new SessionProxyError("REQUEST_INVALID"));
    expect(() => SESSION_BROWSER_V3_ROUTES.snapshot.parseInput({
      pathParameters: { session_id: "session-12345678" },
      query: { cursor: "7" },
      body: undefined,
    })).toThrowError(new SessionProxyError("REQUEST_INVALID"));
  });

  it("uses generated paths and schemas while keeping grant material out-of-band", async () => {
    const accessGrant = grant("read");
    const send = vi.fn<AuthenticatedSessionBrowserV3HttpPort["send"]>(async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: new Response(JSON.stringify({ sessions: [], index_watermark: "index-1" })).body,
      authenticatedBinding: authenticatedBinding(accessGrant),
    }));
    const transport = createSessionBrowserV3Transport({ send });

    const result = await transport.execute({
      operationId: "listSessions",
      input: SESSION_BROWSER_V3_ROUTES.listSessions.parseInput({
        pathParameters: undefined,
        query: {
          project_ref: bootstrap.defaultProjectRef,
          q: "hello world",
          pinned: true,
          limit: 25,
        },
        body: undefined,
      }),
      headers: { accept: "application/json" },
      accessGrant,
      signal: new AbortController().signal,
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      operationId: "listSessions",
      method: "GET",
      pathname: "/v1/sessions",
      query: "limit=25&pinned=true&project_ref=project-12345678&q=hello+world",
      body: null,
      authorization: {
        scheme: "Bearer",
        credential: accessGrant.credential,
        grantRef: accessGrant.grantRef,
        audience: "session.read",
      },
    }));
    expect(result.binding).toEqual({
      grantRef: accessGrant.grantRef,
      ...accessGrant.binding,
      purpose: "read",
      audience: "session.read",
    });
  });

  it("rejects low-level responses not authenticated with the exact grant", async () => {
    const transport = createSessionBrowserV3Transport({
      send: async () => ({
        status: 200,
        headers: { "content-type": "application/json" },
        body: new Response(JSON.stringify({ sessions: [], index_watermark: "index-1" })).body,
        authenticatedBinding: {
          ...authenticatedBinding(grant("read")),
          deploymentRef: "different-deployment",
        },
      }),
    });
    await expect(transport.execute({
      operationId: "listSessions",
      input: SESSION_BROWSER_V3_ROUTES.listSessions.parseInput({
        pathParameters: undefined,
        query: { project_ref: bootstrap.defaultProjectRef },
        body: undefined,
      }),
      headers: {},
      accessGrant: grant("read"),
      signal: new AbortController().signal,
    })).rejects.toEqual(new SessionProxyError("UPSTREAM_BINDING_MISMATCH"));
  });

  it("exposes only registered routes through the v3 proxy", async () => {
    const access = { acquire: vi.fn(async () => grant("read")) } as unknown as SessionAccessManager;
    const proxy = createSessionBrowserV3Proxy({
      bootstrap,
      access,
      browserRequestVerifier: {
        verify: vi.fn((input) => ({
          kind: "same-origin-browser" as const,
          operationId: input.operationId,
          method: input.method,
          origin: "https://chat.example.test",
        })),
      },
      transport: createSessionBrowserV3Transport({
        send: async () => ({
          status: 200,
          headers: { "content-type": "application/json" },
          body: new Response(JSON.stringify({ sessions: [], index_watermark: "index-1" })).body,
          authenticatedBinding: authenticatedBinding(grant("read")),
        }),
      }),
    });
    const response = await proxy.execute({
      operationId: "listSessions",
      browser: {
        method: "GET",
        headers: { origin: "https://chat.example.test", "sec-fetch-site": "same-origin" },
        query: { project_ref: bootstrap.defaultProjectRef },
      },
    });
    expect(response.status).toBe(200);
  });
});

describe("Session browser v3 SSE validation", () => {
  it("waits for a complete frame and validates the generated event envelope", () => {
    const validator = sseValidator();
    const frame = sseFrame(browserEvent(), { id: "signed.cursor.1" });
    expect(validator.push(frame.slice(0, 17))).toEqual([]);
    expect(validator.push(frame.slice(17))).toEqual([frame]);
    expect(validator.finish()).toEqual([]);
  });

  it("accepts CR, LF, CRLF, and mixed line endings", () => {
    const value = browserEvent();
    const mixed = new TextEncoder().encode(
      `id: signed.cursor.1\revent: branch.activated\ndata: ${JSON.stringify(value)}\r\n\r`,
    );
    const expected = new TextEncoder().encode(
      `id: signed.cursor.1\revent: branch.activated\ndata: ${JSON.stringify(value)}\n\n`,
    );
    expect(sseValidator().push(mixed)).toEqual([expected]);
  });

  it("rejects numeric cursors, non-string uint64 values, and mismatched event identity", () => {
    const cases = [
      sseFrame(browserEvent({ cursor: "1" }), { id: "1" }),
      sseFrame(browserEvent({ durable_seq: 1 }), { id: "signed.cursor.1" }),
      sseFrame(browserEvent(), { id: "signed.cursor.other" }),
      sseFrame(browserEvent(), { id: "signed.cursor.1", event: "message.created" }),
    ];
    for (const frame of cases) {
      expect(() => sseValidator().push(frame)).toThrowError(
        new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
      );
    }
  });

  it("keeps stream.draining outside durable cursor identity", () => {
    const draining = {
      kind: "stream.draining",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      last_durable_cursor: "signed.cursor.1",
      action: "retry_same_cursor",
      retry_after_ms: 1000,
    };
    const frame = sseFrame(draining, { event: "stream.draining" });
    expect(sseValidator("signed.cursor.1").push(frame)).toEqual([frame]);
    expect(() => sseValidator("signed.cursor.1").push(
      sseFrame(draining, { id: "signed.cursor.1", event: "stream.draining" }),
    )).toThrowError(new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"));
    expect(() => sseValidator("signed.cursor.initial").push(frame)).toThrowError(
      new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
    );
  });

  it("binds every SSE frame to the requested Session identity", () => {
    expect(() => sseValidator().push(sseFrame(browserEvent({
      session_id: "session-other-12345678",
    }), { id: "signed.cursor.1" }))).toThrowError(
      new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
    );
  });

  it("accepts an exact replay but rejects reuse of a durable sequence for another event", () => {
    const original = browserEvent();
    const replay = sseFrame(original, { id: "signed.cursor.1" });
    const validator = sseValidator();

    expect(validator.push(replay)).toEqual([replay]);
    expect(validator.push(replay)).toEqual([]);
    expect(() => validator.push(sseFrame(browserEvent({
      event_id: "event-different-12345678",
      cursor: "signed.cursor.different",
    }), { id: "signed.cursor.different" }))).toThrowError(
      new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
    );
  });

  it("passes comment heartbeats but rejects an incomplete terminal frame", () => {
    const heartbeat = new TextEncoder().encode(": heartbeat\n\n");
    const validator = sseValidator();
    expect(validator.push(heartbeat)).toEqual([heartbeat]);
    validator.push(new TextEncoder().encode("event: branch.activated\n"));
    expect(() => validator.finish()).toThrowError(new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"));
  });
});
