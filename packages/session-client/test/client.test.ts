import { describe, expect, it, vi } from "vitest";

import {
  createSessionClient,
  type SessionTransport,
} from "../src/client.js";

const DIGEST = "a".repeat(64);

function jsonResponse(status: number, body: unknown, contentType = "application/json") {
  return { status, body, headers: new Headers({ "content-type": contentType }) };
}

function snapshot() {
  return {
    session: {
      session_id: "session-12345678",
      project_ref: "project-12345678",
      title: "Thread",
      lifecycle: "active",
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
      cursor: "signed.cursor.7",
      stream_epoch: "epoch-12345678",
      durable_seq: "7",
      projection_version: 1,
    },
  };
}

function commandResponse(operation = "submit_message") {
  return {
    command_receipt: {
      operation,
      command_id: "command-12345678",
      idempotency_key: "idempotency-12345678",
      digest_algorithm: "SHA256_CANONICAL_JSON_V1",
      request_digest: DIGEST,
      updated_at: "2026-07-28T00:00:00.000Z",
      status: "pending",
      payload: {
        retry_class: "reconcile_receipt",
        action: "reconcile_receipt",
      },
    },
  };
}

function problem(code: string, action: string, retryClass: string) {
  return {
    error: {
      code,
      message: "request rejected",
      retry_class: retryClass,
      action,
    },
    request_id: "request-12345678",
    correlation_id: "correlation-12345678",
  };
}

describe("contract-bound Session v3 client", () => {
  it("hydrates the complete projection from its opaque snapshot watermark", async () => {
    const calls: string[] = [];
    const transport: SessionTransport = {
      request: async (request) => {
        calls.push(request.path);
        return jsonResponse(200, snapshot());
      },
      stream: async () => ({ status: 500, headers: new Headers(), body: null }),
    };
    const client = createSessionClient({ transport });

    const hydration = await client.hydrate("session-12345678");

    expect(hydration).toMatchObject({ kind: "ready", cursor: "signed.cursor.7" });
    expect(calls).toEqual(["/v1/sessions/session-12345678/snapshot"]);
  });

  it("uses only opaque Last-Event-ID and validates event/id/cursor equality", async () => {
    const seen: Array<{ path: string; headers?: Readonly<Record<string, string>> }> = [];
    const event = {
      kind: "branch.activated",
      event_id: "event-12345678",
      cursor: "signed.cursor.8",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      durable_seq: "8",
      projection_version: 2,
      schema_revision: 3,
      recorded_at: "2026-07-28T00:00:01.000Z",
      payload: { branch_id: "branch-12345678", session_version: 2 },
    };
    const body = new TextEncoder().encode(
      `id: signed.cursor.8\nevent: branch.activated\ndata: ${JSON.stringify(event)}\n\n`,
    );
    const transport: SessionTransport = {
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
    };
    const onEvent = vi.fn();
    const client = createSessionClient({ transport });
    const handle = client.openEvents({
      sessionId: "session-12345678",
      cursor: "signed.cursor.7",
      onEvent,
      onConnection: vi.fn(),
    });
    await handle.ready;
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    handle.close();

    expect(seen[0]?.path).toBe("/v1/sessions/session-12345678/events");
    expect(seen[0]?.path).not.toContain("?");
    expect(seen[0]?.headers?.["last-event-id"]).toBe("signed.cursor.7");
    expect(onEvent).toHaveBeenCalledWith(event, "signed.cursor.8");
  });

  it("rejects reuse of a durable sequence for a different event identity", async () => {
    const first = {
      kind: "branch.activated",
      event_id: "event-12345678",
      cursor: "signed.cursor.8",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      durable_seq: "8",
      projection_version: 2,
      schema_revision: 3,
      recorded_at: "2026-07-28T00:00:01.000Z",
      payload: { branch_id: "branch-12345678", session_version: 2 },
    };
    const second = {
      ...first,
      event_id: "event-different-12345678",
      cursor: "signed.cursor.different",
    };
    const body = new TextEncoder().encode([
      `id: ${first.cursor}\nevent: ${first.kind}\ndata: ${JSON.stringify(first)}\n\n`,
      `id: ${second.cursor}\nevent: ${second.kind}\ndata: ${JSON.stringify(second)}\n\n`,
    ].join(""));
    const onConnection = vi.fn();
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(500, {}),
        stream: async () => ({
          status: 200,
          headers: new Headers({ "content-type": "text/event-stream" }),
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(body);
              controller.close();
            },
          }),
        }),
      },
    });
    const handle = client.openEvents({
      sessionId: "session-12345678",
      cursor: "signed.cursor.7",
      onEvent: vi.fn(),
      onConnection,
    });
    await handle.ready;
    await vi.waitFor(() => expect(onConnection).toHaveBeenCalledWith(expect.objectContaining({
      kind: "contract_incompatible",
    })));
    handle.close();
  });

  it("suppresses an exact replay by opaque cursor and event identity", async () => {
    const event = {
      kind: "branch.activated",
      event_id: "event-12345678",
      cursor: "signed.cursor.8",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      durable_seq: "8",
      projection_version: 2,
      schema_revision: 3,
      recorded_at: "2026-07-28T00:00:01.000Z",
      payload: { branch_id: "branch-12345678", session_version: 2 },
    };
    const frame = `id: ${event.cursor}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
    const onEvent = vi.fn();
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(500, {}),
        stream: async () => ({
          status: 200,
          headers: new Headers({ "content-type": "text/event-stream" }),
          body: new Response(`${frame}${frame}`).body,
        }),
      },
    });
    const handle = client.openEvents({
      sessionId: "session-12345678",
      cursor: "signed.cursor.7",
      onEvent,
      onConnection: vi.fn(),
    });
    await handle.ready;
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    handle.close();
  });

  it("bounded-decodes an SSE upgrade problem and preserves its stable recovery fields", async () => {
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
    const handle = client.openEvents({
      sessionId: "session-12345678",
      cursor: "signed.cursor.7",
      onEvent: vi.fn(),
      onConnection: vi.fn(),
    });

    await expect(handle.ready).rejects.toMatchObject({
      kind: "contract_incompatible",
      status: 426,
      stableCode: "CLIENT_CONTRACT_UPGRADE_REQUIRED",
      action: "upgrade_client",
      retryClass: "after_user_action",
    });
    handle.close();
  });

  it("propagates generated problem details as a typed auth failure", async () => {
    const transport: SessionTransport = {
      request: async () => jsonResponse(
        401,
        problem("SESSION_ACCESS_GRANT_EXPIRED", "refresh_grant", "after_user_action"),
        "application/problem+json",
      ),
      stream: async () => ({ status: 500, headers: new Headers(), body: null }),
    };
    const client = createSessionClient({ transport });

    await expect(client.fetchSnapshot("session-12345678")).rejects.toMatchObject({
      kind: "auth_required",
      status: 401,
      stableCode: "SESSION_ACCESS_GRANT_EXPIRED",
      action: "refresh_grant",
      correlationId: "correlation-12345678",
    });
  });

  it("validates submit input and preserves the complete command identity", async () => {
    const bodies: unknown[] = [];
    const transport: SessionTransport = {
      request: async (request) => {
        bodies.push(request.body);
        return jsonResponse(202, commandResponse());
      },
      stream: async () => ({ status: 500, headers: new Headers(), body: null }),
    };
    const client = createSessionClient({ transport });
    const command = {
      command_id: "command-12345678",
      idempotency_key: "idempotency-12345678",
      digest_algorithm: "SHA256_CANONICAL_JSON_V1" as const,
      request_digest: DIGEST,
    };

    const response = await client.submitMessage("session-12345678", {
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
});
