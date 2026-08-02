import { describe, expect, it, vi } from "vitest";

import fixtureJson from "./fixtures/root-agui-presentation-v1.json";
import {
  createSessionClient,
  SESSION_CLIENT_OPERATION_SURFACE,
  type SessionTransport,
} from "../src/client.js";
import { AguiPresentationProtocolError } from "../src/agui-presentation.js";
import {
  SESSION_HTTP_ENDPOINTS,
  submitMessageRequestSchema,
  type ErrorEnvelope,
} from "../src/contracts.js";

const DIGEST = "a".repeat(64);
const fixture = fixtureJson.positiveCases[0];
if (fixture === undefined) throw new Error("Root AG-UI fixture missing");
const SESSION_ID = fixture.grantBinding.sessionId;

function jsonResponse(status: number, body: unknown, contentType = "application/json") {
  return { status, body, headers: new Headers({ "content-type": contentType }) };
}

function snapshot(presentationAuthority: unknown = {
  ...fixture.snapshot,
  runBindings: [],
  messageBindings: [],
}) {
  return {
    session: {
      session_id: SESSION_ID,
      project_ref: "project-12345678",
      title: "Thread",
      lifecycle: "active",
      context_policy: "standard",
      active_branch_id: "branch-12345678",
      version: 1,
      created_at: "2026-07-28T00:00:00.000Z",
      updated_at: "2026-07-28T00:00:00.000Z",
    },
    branches: [{
      branch_id: "branch-12345678",
      origin: "original",
      version: 1,
      created_at: "2026-07-28T00:00:00.000Z",
    }],
    messages: [],
    run_launches: [],
    runs: [],
    controls: [],
    costs: [],
    model_history: [],
    snapshot_watermark: {
      snapshot_revision_ref: "snapshot.revision.1",
      projection_version: 1,
    },
    presentation_authority: presentationAuthority,
  };
}

function commandResponse(operation = "submit_message") {
  return {
    command_receipt: {
      operation,
      command_id: "command-12345678",
      idempotency_key: "idempotency-12345678",
      digest_algorithm: "SHA256_CANONICAL_JSON_V2",
      request_digest: DIGEST,
      updated_at: "2026-07-28T00:00:00.000Z",
      status: "pending",
      payload: { retry_class: "reconcile_receipt", action: "reconcile_receipt" },
    },
  };
}

function problem(
  code: ErrorEnvelope["error"]["code"],
  action: ErrorEnvelope["error"]["action"],
  retryClass: ErrorEnvelope["error"]["retry_class"],
): ErrorEnvelope {
  return {
    error: { code, message: "request rejected", retry_class: retryClass, action },
    request_id: "request-12345678",
    correlation_id: "correlation-12345678",
  };
}

describe("contract-bound Session AG-UI client", () => {
  it("keeps its callable operation surface exhaustive with the generated registry", () => {
    expect(Object.keys(SESSION_CLIENT_OPERATION_SURFACE).sort()).toEqual(Object.keys(SESSION_HTTP_ENDPOINTS).sort());
    expect(SESSION_CLIENT_OPERATION_SURFACE.stream).toBe("openPresentation");
  });

  it("hydrates one strict snapshot and exposes its typed presentation authority", async () => {
    const paths: string[] = [];
    const client = createSessionClient({
      transport: {
        request: async (request) => {
          paths.push(request.path);
          return jsonResponse(200, snapshot());
        },
        stream: async () => ({ status: 500, headers: new Headers(), body: null }),
      },
    });

    const hydration = await client.hydrate(SESSION_ID);

    expect(hydration).toMatchObject({
      kind: "ready",
      grant: fixture.grantBinding,
      snapshotAuthority: { cursor: fixture.snapshot.cursor, sessionId: SESSION_ID },
    });
    expect(paths).toEqual([`/v1/sessions/${encodeURIComponent(SESSION_ID)}/snapshot`]);
  });

  it("fails closed when snapshot presentation authority is not valid", async () => {
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(200, snapshot({ cursor: "browser-made" })),
        stream: async () => ({ status: 500, headers: new Headers(), body: null }),
      },
    });

    await expect(client.hydrate(SESSION_ID)).resolves.toMatchObject({
      kind: "contract_incompatible",
    });
  });

  it("forwards cancellation to the single snapshot request", async () => {
    const requests: Parameters<SessionTransport["request"]>[0][] = [];
    const client = createSessionClient({
      transport: {
        request: async (request) => {
          requests.push(request);
          return jsonResponse(200, snapshot());
        },
        stream: async () => ({ status: 500, headers: new Headers(), body: null }),
      },
    });
    const controller = new AbortController();

    await client.hydrate(SESSION_ID, { signal: controller.signal });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.signal).toBe(controller.signal);
  });

  it("uses decoder-owned opaque resume authority and forwards raw AG-UI SSE once", async () => {
    const seen: Parameters<SessionTransport["stream"]>[0][] = [];
    const onFrame = vi.fn(() => Object.freeze({ kind: "durable" as const }));
    const opaqueCursor = fixture.snapshot.cursor;
    const body = new TextEncoder().encode("id: next.opaque\nevent: TEXT_MESSAGE_CONTENT\ndata: {\"opaque\":true}\n\n");
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(500, {}),
        stream: async (request) => {
          seen.push(request);
          return {
            status: 200,
            headers: new Headers({ "content-type": "text/event-stream" }),
            body: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(body);
              },
            }),
          };
        },
      },
    });
    const handle = client.openPresentation({
      sessionId: SESSION_ID,
      resume: () => ({
        headers: { "last-event-id": opaqueCursor },
        queryCursor: opaqueCursor,
        cursorBinding: {
          cursor: opaqueCursor,
          sessionId: SESSION_ID,
          streamEpoch: "41",
          durableSeq: "0",
          profileRevision: "kokoro-agui-presentation.v1",
          cursorProfileRevision: "opaque-session-cursor-v1",
        },
      }),
      onFrame,
      onConnection: vi.fn(),
    });

    await handle.ready;
    await vi.waitFor(() => expect(onFrame).toHaveBeenCalledOnce());
    handle.close();

    const request = seen[0];
    expect(request?.headers?.["last-event-id"]).toBe(opaqueCursor);
    expect(new URL(request?.path ?? "", "https://web.invalid").searchParams.get("after")).toBe(opaqueCursor);
    expect(onFrame).toHaveBeenCalledWith({
      id: "next.opaque",
      event: "TEXT_MESSAGE_CONTENT",
      data: "{\"opaque\":true}",
    });
  });

  it("honors decoder-admitted draining delay before reconnecting", async () => {
    vi.useFakeTimers();
    try {
      const stream = vi.fn(async () => ({
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: new Response("event: kokoro.stream.draining\ndata: {}\n\n").body,
      }));
      const client = createSessionClient({
        transport: { request: async () => jsonResponse(500, {}), stream },
        reconnectDelayMs: 1,
        reconnectMaxDelayMs: 100,
      });
      const handle = client.openPresentation({
        sessionId: SESSION_ID,
        resume: () => ({
          headers: { "last-event-id": fixture.snapshot.cursor },
          queryCursor: fixture.snapshot.cursor,
          cursorBinding: {
            cursor: fixture.snapshot.cursor,
            sessionId: SESSION_ID,
            streamEpoch: "41",
            durableSeq: "0",
            profileRevision: "kokoro-agui-presentation.v1",
            cursorProfileRevision: "opaque-session-cursor-v1",
          },
        }),
        onFrame: () => ({ kind: "draining", retryAfterMs: 25 }),
        onConnection: vi.fn(),
      });
      await handle.ready;
      await vi.advanceTimersByTimeAsync(24);
      expect(stream).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(stream).toHaveBeenCalledTimes(2);
      handle.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats exhausted AG-UI authority capacity as rehydration instead of incompatibility", async () => {
    const onConnection = vi.fn();
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(500, {}),
        stream: async () => ({
          status: 200,
          headers: new Headers({ "content-type": "text/event-stream" }),
          body: new Response("id: next.opaque\nevent: RUN_STARTED\ndata: {}\n\n").body,
        }),
      },
    });
    const handle = client.openPresentation({
      sessionId: SESSION_ID,
      resume: () => ({
        headers: { "last-event-id": fixture.snapshot.cursor },
        queryCursor: fixture.snapshot.cursor,
        cursorBinding: {
          cursor: fixture.snapshot.cursor,
          sessionId: SESSION_ID,
          streamEpoch: "41",
          durableSeq: "0",
          profileRevision: "kokoro-agui-presentation.v1",
          cursorProfileRevision: "opaque-session-cursor-v1",
        },
      }),
      onFrame: () => {
        throw new AguiPresentationProtocolError("agui_authority_capacity_exceeded");
      },
      onConnection,
    });

    await handle.ready;
    await vi.waitFor(() => expect(onConnection).toHaveBeenCalledWith(expect.objectContaining({
      kind: "repair_required",
    })));
    expect(onConnection).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "contract_incompatible" }));
    handle.close();
  });

  it("bounded-decodes an SSE upgrade problem with stable recovery fields", async () => {
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(500, {}),
        stream: async () => ({
          status: 426,
          headers: new Headers({ "content-type": "application/problem+json" }),
          body: new Response(JSON.stringify(problem(
            "CLIENT_CONTRACT_UPGRADE_REQUIRED",
            "upgrade_client",
            "after_user_action",
          ))).body,
        }),
      },
    });
    const handle = client.openPresentation({
      sessionId: SESSION_ID,
      resume: () => ({
        headers: { "last-event-id": fixture.snapshot.cursor },
        queryCursor: fixture.snapshot.cursor,
        cursorBinding: {
          cursor: fixture.snapshot.cursor,
          sessionId: SESSION_ID,
          streamEpoch: "41",
          durableSeq: "0",
          profileRevision: "kokoro-agui-presentation.v1",
          cursorProfileRevision: "opaque-session-cursor-v1",
        },
      }),
      onFrame: () => ({ kind: "replay" }),
      onConnection: vi.fn(),
    });

    await expect(handle.ready).rejects.toMatchObject({
      kind: "contract_incompatible",
      status: 426,
      stableCode: "CLIENT_CONTRACT_UPGRADE_REQUIRED",
    });
    handle.close();
  });

  it("propagates generated problem details as typed auth failure", async () => {
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(
          401,
          problem("SESSION_ACCESS_GRANT_EXPIRED", "refresh_grant", "after_user_action"),
          "application/problem+json",
        ),
        stream: async () => ({ status: 500, headers: new Headers(), body: null }),
      },
    });

    await expect(client.fetchSnapshot(SESSION_ID)).rejects.toMatchObject({
      kind: "auth_required",
      stableCode: "SESSION_ACCESS_GRANT_EXPIRED",
      correlationId: "correlation-12345678",
    });
  });

  it("validates Submit and preserves the complete command identity", async () => {
    const bodies: unknown[] = [];
    const client = createSessionClient({
      transport: {
        request: async (request) => {
          bodies.push(request.body);
          return jsonResponse(202, commandResponse());
        },
        stream: async () => ({ status: 500, headers: new Headers(), body: null }),
      },
    });
    const command = {
      command_id: "command-12345678",
      idempotency_key: "idempotency-12345678",
      digest_algorithm: "SHA256_CANONICAL_JSON_V2" as const,
      request_digest: DIGEST,
    };

    const response = await client.submitMessage(SESSION_ID, {
      command,
      expected_session_version: 1,
      branch_id: "branch-12345678",
      parent_message_id: null,
      trusted_locale: "en-US",
      parts: [{ kind: "text", schema_version: 1, payload: { text: "hello" } }],
      attachment_refs: [],
      model_option_revision_ref: "model-option-12345678",
    });

    expect(bodies).toEqual([expect.objectContaining({ command })]);
    expect(response).toEqual(commandResponse());
  });

  it("admits attachment-only Submit while rejecting empty commands", () => {
    const base = {
      command: {
        command_id: "command-attachment-only",
        idempotency_key: "idempotency-attachment-only",
        digest_algorithm: "SHA256_CANONICAL_JSON_V2" as const,
        request_digest: DIGEST,
      },
      expected_session_version: 1,
      branch_id: "branch-12345678",
      parent_message_id: null,
      trusted_locale: "en-US",
      attachment_refs: [{
        asset_ref: "asset-12345678",
        asset_version_ref: "asset-version-12345678",
        asset_grant_ref: "asset-grant-12345678",
      }],
      model_option_revision_ref: "model-option-12345678",
    };

    expect(submitMessageRequestSchema.safeParse({ ...base, parts: [] }).success).toBe(true);
    expect(submitMessageRequestSchema.safeParse({ ...base, parts: [], attachment_refs: [] }).success).toBe(false);
  });
});
