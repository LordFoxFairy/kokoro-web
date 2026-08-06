import { readFileSync } from "node:fs";

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
type CanonicalPresentationFrame = Readonly<{
  id: string;
  event: string;
  data: Readonly<Record<string, unknown>>;
}>;
type CanonicalPresentationCase = Readonly<{
  snapshot: Readonly<{ cursor: string; sessionId: string }>;
  frames: readonly CanonicalPresentationFrame[];
}>;
const presentationCorpus = JSON.parse(readFileSync(
  new URL("../../session-client/test/fixtures/root-agui-presentation-v1.json", import.meta.url),
  "utf8",
)) as Readonly<{ positiveCases: readonly CanonicalPresentationCase[] }>;
const canonicalPresentation = presentationCorpus.positiveCases[0];
if (canonicalPresentation === undefined) throw new Error("canonical AG-UI presentation fixture missing");

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
      authorizationStreamSequence: "11",
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

function sseValidator(
  initialCursor = canonicalPresentation.snapshot.cursor,
  sessionId = canonicalPresentation.snapshot.sessionId,
) {
  return createSessionBrowserV3SseFrameValidator({ initialCursor, sessionId });
}

function canonicalFrame(index: number): CanonicalPresentationFrame {
  const frame = canonicalPresentation.frames[index];
  if (frame === undefined) throw new Error(`canonical AG-UI frame ${index} missing`);
  return structuredClone(frame);
}

function sseFrame(
  frame: Readonly<{ id?: string | null; event: string; data: unknown }>,
): Uint8Array {
  const id = frame.id === undefined || frame.id === null ? "" : `id: ${frame.id}\n`;
  return new TextEncoder().encode(`${id}event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
}

function sequenceZeroSnapshot() {
  return {
    session: {
      session_id: "session-12345678",
      project_ref: bootstrap.defaultProjectRef,
      title: "Thread",
      lifecycle: "active",
      context_policy: "standard",
      active_branch_id: "branch-12345678",
      version: 1,
      created_at: "2026-07-28T12:00:00.000Z",
      updated_at: "2026-07-28T12:00:00.000Z",
    },
    branches: [{
      branch_id: "branch-12345678",
      origin: "original",
      version: 1,
      created_at: "2026-07-28T12:00:00.000Z",
    }],
    messages: [],
    run_launches: [],
    runs: [],
    controls: [],
    costs: [],
    model_history: [],
    snapshot_watermark: {
      snapshot_revision_ref: `session.snapshot:sha256:${DIGEST}`,
      projection_version: 1,
    },
    presentation_snapshot: {
      cursor: "signed.presentation.cursor.0",
    },
  };
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
      expectedBinding: authenticatedBinding(accessGrant),
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

  it("accepts the canonical sequence-zero snapshot without a retired watermark cursor", async () => {
    const accessGrant = grant("read");
    const access = {
      acquire: vi.fn(async () => accessGrant),
    } as unknown as SessionAccessManager;
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
          body: new Response(JSON.stringify(sequenceZeroSnapshot())).body,
          authenticatedBinding: authenticatedBinding(accessGrant),
        }),
      }),
    });

    const response = await proxy.execute({
      operationId: "snapshot",
      browser: {
        method: "GET",
        headers: { origin: "https://chat.example.test", "sec-fetch-site": "same-origin" },
        pathParameters: { session_id: "session-12345678" },
        query: {},
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      snapshot_watermark: {
        snapshot_revision_ref: `session.snapshot:sha256:${DIGEST}`,
        projection_version: 1,
      },
      presentation_snapshot: { cursor: "signed.presentation.cursor.0" },
    });
  });
});

describe("Session browser v3 SSE validation", () => {
  it("waits for complete frames and validates the canonical AG-UI corpus contiguously", () => {
    const validator = sseValidator();
    const firstFixture = canonicalFrame(0);
    const secondFixture = canonicalFrame(1);
    const first = sseFrame(firstFixture);
    const second = sseFrame(secondFixture);
    expect(validator.push(first.slice(0, 17))).toEqual([]);
    expect(validator.push(first.slice(17))).toEqual([first]);
    expect(validator.push(second)).toEqual([second]);
    expect(validator.finish()).toEqual([]);
  });

  it("accepts CR, LF, CRLF, and mixed line endings", () => {
    const frame = canonicalFrame(0);
    const mixed = new TextEncoder().encode(
      `id: ${frame.id}\revent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\r\n\r`,
    );
    const expected = new TextEncoder().encode(
      `id: ${frame.id}\revent: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`,
    );
    expect(sseValidator().push(mixed)).toEqual([expected]);
  });

  it("hard-cuts the legacy Session event envelope", () => {
    expect(() => sseValidator().push(sseFrame({
      id: canonicalFrame(0).id,
      event: "branch.activated",
      data: {
        kind: "branch.activated",
        event_id: "event-12345678",
        cursor: canonicalFrame(0).id,
        session_id: canonicalPresentation.snapshot.sessionId,
        stream_epoch: "41",
        durable_seq: "1",
        projection_version: 1,
        schema_revision: 3,
        recorded_at: "2026-08-01T12:00:01.000Z",
        payload: { branch_id: "branch-12345678", session_version: 1 },
      },
    }))).toThrowError(new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"));
  });

  it("rejects event, Session, and uint64 drift from the canonical payload", () => {
    const eventMismatch = canonicalFrame(0);
    const sessionMismatch = canonicalFrame(0);
    const numericSequence = canonicalFrame(0);
    const sourceMappingMismatch = canonicalFrame(0);
    const discriminatorMismatch = canonicalFrame(4);
    const sessionSource = sessionMismatch.data.source as Record<string, unknown>;
    const sequenceSource = numericSequence.data.source as Record<string, unknown>;
    sessionSource.sessionId = "session.other";
    sequenceSource.durableSeq = 1;
    (sourceMappingMismatch.data.source as Record<string, unknown>).sourceKind =
      "presentation.message.text.started";
    (discriminatorMismatch.data.source as Record<string, unknown>).sourceKind =
      "presentation.activity.safe-summary";

    for (const frame of [
      { ...eventMismatch, event: "TEXT_MESSAGE_START" },
      sessionMismatch,
      numericSequence,
      sourceMappingMismatch,
      discriminatorMismatch,
    ]) {
      expect(() => sseValidator().push(sseFrame(frame))).toThrowError(
        new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
      );
    }
  });

  it("keeps canonical stream draining outside durable cursor identity", () => {
    const first = canonicalFrame(0);
    const validator = sseValidator();
    expect(validator.push(sseFrame(first))).toEqual([sseFrame(first)]);
    const draining = {
      type: "stream.draining",
      profileRevision: "kokoro-agui-presentation.v1",
      sessionId: canonicalPresentation.snapshot.sessionId,
      streamEpoch: String((first.data.source as Record<string, unknown>).streamEpoch),
      lastDurableCursor: first.id,
      action: "retry-same-cursor",
      retryAfterMs: 1000,
    };
    const frame = sseFrame({ event: "kokoro.stream.draining", data: draining });
    expect(validator.push(frame)).toEqual([frame]);
    expect(() => sseValidator(first.id).push(sseFrame({
      id: first.id,
      event: "kokoro.stream.draining",
      data: draining,
    }))).toThrowError(new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"));
    expect(() => sseValidator(canonicalPresentation.snapshot.cursor).push(frame)).toThrowError(
      new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
    );
    expect(() => sseValidator(first.id).push(sseFrame({
      event: "stream.draining",
      data: {
        kind: "stream.draining",
        session_id: canonicalPresentation.snapshot.sessionId,
        stream_epoch: String((first.data.source as Record<string, unknown>).streamEpoch),
        last_durable_cursor: first.id,
        action: "retry_same_cursor",
      },
    }))).toThrowError(new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"));
  });

  it("rejects a durable gap", () => {
    const first = canonicalFrame(0);
    const skipped = canonicalFrame(1);
    (skipped.data.source as Record<string, unknown>).durableSeq = "3";
    const validator = sseValidator();
    expect(validator.push(sseFrame(first))).toEqual([sseFrame(first)]);
    expect(() => validator.push(sseFrame(skipped))).toThrowError(
      new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
    );
  });

  it("accepts an exact replay but rejects reuse of a durable sequence for another event", () => {
    const original = canonicalFrame(0);
    const replay = sseFrame(original);
    const validator = sseValidator();

    expect(validator.push(replay)).toEqual([replay]);
    expect(validator.push(replay)).toEqual([]);
    const changedCursor = canonicalFrame(0);
    expect(() => validator.push(sseFrame({
      ...changedCursor,
      id: `${changedCursor.id.slice(0, -1)}A`,
    }))).toThrowError(
      new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
    );

    const changedSource = canonicalFrame(0);
    (changedSource.data.source as Record<string, unknown>).sourceEventId =
      `presentation.event:${"f".repeat(64)}`;
    expect(() => validator.push(sseFrame({
      ...changedSource,
      id: original.id,
    }))).toThrowError(
      new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"),
    );
  });

  it("passes comment heartbeats but rejects an incomplete terminal frame", () => {
    const heartbeat = new TextEncoder().encode(": heartbeat\n\n");
    const validator = sseValidator();
    expect(validator.push(heartbeat)).toEqual([heartbeat]);
    validator.push(new TextEncoder().encode("event: RUN_STARTED\n"));
    expect(() => validator.finish()).toThrowError(new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"));
  });
});
