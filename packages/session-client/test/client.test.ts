import { describe, expect, it, vi } from "vitest";

import {
  createSessionClient,
  SESSION_CLIENT_OPERATION_SURFACE,
  type SessionTransport,
} from "../src/client.js";
import { SESSION_HTTP_ENDPOINTS, submitMessageRequestSchema } from "../src/contracts.js";

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
      digest_algorithm: "SHA256_CANONICAL_JSON_V2",
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
  it("keeps its callable operation surface exhaustive with the generated registry", () => {
    expect(Object.keys(SESSION_CLIENT_OPERATION_SURFACE).sort()).toEqual(Object.keys(SESSION_HTTP_ENDPOINTS).sort());
  });

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
      watermark: snapshot().snapshot_watermark,
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
      watermark: snapshot().snapshot_watermark,
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
      watermark: snapshot().snapshot_watermark,
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
      watermark: snapshot().snapshot_watermark,
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
      digest_algorithm: "SHA256_CANONICAL_JSON_V2" as const,
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

  it("admits attachment-only Submit while rejecting empty commands and explicit empty text", () => {
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
    expect(submitMessageRequestSchema.safeParse({
      ...base,
      parts: [],
      attachment_refs: [],
    }).success).toBe(false);
    expect(submitMessageRequestSchema.safeParse({
      ...base,
      parts: [{ kind: "text", schema_version: 1, payload: { text: "" } }],
    }).success).toBe(false);
  });

  it.each([
    [409, problem("CLIENT_CONTRACT_UPGRADE_REQUIRED", "upgrade_client", "after_user_action"), "contract_incompatible"],
    [409, problem("IDEMPOTENCY_CONFLICT", "reconcile_receipt", "reconcile_receipt"), "command_conflict"],
    [403, problem("ADMISSION_DENIED", "show_reason", "never"), "http"],
    [403, problem("SESSION_SCOPE_MISMATCH", "stop", "never"), "http"],
    [401, problem("BFF_WORKLOAD_REVOKED", "stop", "never"), "http"],
    [400, problem("SNAPSHOT_REQUIRED", "refetch_snapshot", "immediate"), "repair_required"],
  ])("classifies status %i by stable problem semantics", async (status, body, kind) => {
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(status, body, "application/problem+json"),
        stream: async () => ({ status: 500, headers: new Headers(), body: null }),
      },
    });

    await expect(client.fetchSnapshot("session-12345678")).rejects.toMatchObject({ kind });
  });

  it("anchors the first event to both the snapshot epoch and immediately following durable sequence", async () => {
    const baseEvent = {
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
    for (const mismatched of [
      { ...baseEvent, cursor: "signed.cursor.9", durable_seq: "9" },
      { ...baseEvent, stream_epoch: "epoch-other-12345678" },
    ]) {
      const onConnection = vi.fn();
      const client = createSessionClient({
        transport: {
          request: async () => jsonResponse(500, {}),
          stream: async () => ({
            status: 200,
            headers: new Headers({ "content-type": "text/event-stream" }),
            body: new Response(`id: ${mismatched.cursor}\revent: ${mismatched.kind}\ndata: ${JSON.stringify(mismatched)}\r\n\r`).body,
          }),
        },
      });
      const handle = client.openEvents({
        sessionId: "session-12345678",
        watermark: snapshot().snapshot_watermark,
        onEvent: vi.fn(),
        onConnection,
      });
      await handle.ready;
      await vi.waitFor(() => expect(onConnection).toHaveBeenCalledWith(expect.objectContaining({ kind: "contract_incompatible" })));
      handle.close();
    }
  });

  it("parses CR, LF, CRLF, and mixed SSE line endings across one frame", async () => {
    const next = {
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
    const onEvent = vi.fn();
    const client = createSessionClient({
      transport: {
        request: async () => jsonResponse(500, {}),
        stream: async () => ({
          status: 200,
          headers: new Headers({ "content-type": "text/event-stream" }),
          body: new Response(`id: ${next.cursor}\revent: ${next.kind}\ndata: ${JSON.stringify(next)}\r\n\r`).body,
        }),
      },
    });
    const handle = client.openEvents({
      sessionId: "session-12345678",
      watermark: snapshot().snapshot_watermark,
      onEvent,
      onConnection: vi.fn(),
    });
    await handle.ready;
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    handle.close();
  });

  it("honors the authoritative draining retry delay before reconnecting", async () => {
    vi.useFakeTimers();
    try {
      const draining = {
        kind: "stream.draining",
        session_id: "session-12345678",
        stream_epoch: "epoch-12345678",
        last_durable_cursor: "signed.cursor.7",
        action: "retry_same_cursor",
        retry_after_ms: 25,
      };
      const stream = vi.fn(async () => ({
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: new Response(`event: stream.draining\ndata: ${JSON.stringify(draining)}\n\n`).body,
      }));
      const client = createSessionClient({
        transport: { request: async () => jsonResponse(500, {}), stream },
        reconnectDelayMs: 1,
        reconnectMaxDelayMs: 100,
      });
      const handle = client.openEvents({
        sessionId: "session-12345678",
        watermark: snapshot().snapshot_watermark,
        onEvent: vi.fn(),
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

  it("keeps the initial stream attach alive across a transient network failure", async () => {
    vi.useFakeTimers();
    try {
      const stream = vi.fn()
        .mockRejectedValueOnce(new TypeError("network unavailable"))
        .mockResolvedValue({
          status: 200,
          headers: new Headers({ "content-type": "text/event-stream" }),
          body: new Response("").body,
        });
      const onConnection = vi.fn();
      const client = createSessionClient({
        transport: { request: async () => jsonResponse(500, {}), stream },
        reconnectDelayMs: 1,
        reconnectMaxDelayMs: 10,
        random: () => 0,
      });
      const handle = client.openEvents({
        sessionId: "session-12345678",
        watermark: snapshot().snapshot_watermark,
        onEvent: vi.fn(),
        onConnection,
      });
      const readyOutcome = handle.ready.then(() => "ready", () => "rejected");

      await vi.advanceTimersByTimeAsync(0);

      expect(stream).toHaveBeenCalledTimes(2);
      await expect(readyOutcome).resolves.toBe("ready");
      expect(onConnection).toHaveBeenCalledWith({ kind: "reconnecting" });
      expect(onConnection).toHaveBeenCalledWith({ kind: "live" });
      handle.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("deduplicates an exact durable event replay after reconnect and delivers the next event", async () => {
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
    const next = {
      ...first,
      event_id: "event-12345679",
      cursor: "signed.cursor.9",
      durable_seq: "9",
      projection_version: 3,
      payload: { branch_id: "branch-next-12345678", session_version: 3 },
    };
    const frame = (value: typeof first): string =>
      `id: ${value.cursor}\nevent: ${value.kind}\ndata: ${JSON.stringify(value)}\n\n`;
    const stream = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: new Response(frame(first)).body,
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ "content-type": "text/event-stream" }),
        body: new Response(`${frame(first)}${frame(next)}`).body,
      });
    const streamControl: { close?: () => void } = {};
    const onEvent = vi.fn((received: { readonly durable_seq: string }) => {
      if (received.durable_seq === "9") streamControl.close?.();
    });
    const client = createSessionClient({
      transport: { request: async () => jsonResponse(500, {}), stream },
      reconnectDelayMs: 1,
      reconnectMaxDelayMs: 1,
      random: () => 0,
    });
    const handle = client.openEvents({
      sessionId: "session-12345678",
      watermark: snapshot().snapshot_watermark,
      onEvent,
      onConnection: vi.fn(),
    });
    streamControl.close = () => handle.close();

    await handle.ready;
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2));

    expect(stream).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls.map(([received]) => received.durable_seq)).toEqual(["8", "9"]);
    handle.close();
  });
});
