import { describe, expect, it } from "vitest"

import {
  createSessionClient,
  type SessionTransport,
} from "../src/client.js"

function jsonResponse(status: number, body: unknown) {
  return { status, body, headers: new Headers({ "content-type": "application/json" }) }
}

describe("contract-bound Session client", () => {
  it("hydrates from a snapshot before opening a durable stream", async () => {
    const calls: Array<{ kind: string; path: string; headers?: Readonly<Record<string, string>> }> = []
    const transport: SessionTransport = {
      request: async (request) => {
        calls.push({ kind: "request", path: request.path })
        return jsonResponse(200, {
          session: {
            session_id: "ses_1",
            title: "Thread",
            owner_id: "owner_1",
            created_at: "2026-07-28T00:00:00Z",
            updated_at: "2026-07-28T00:00:00Z",
          },
          messages: [],
          pending_pauses: [],
          files: [],
          deliveries: [],
          event_watermark: 7,
        })
      },
      stream: async (request) => {
        calls.push({ kind: "stream", path: request.path, headers: request.headers })
        return { status: 200, headers: new Headers(), body: new ReadableStream() }
      },
    }

    const client = createSessionClient({ transport })
    const hydration = await client.hydrate("ses_1")

    // The current legacy Root schema must fail closed until Wave 3 Task 2 adds
    // complete snapshots and an opaque cursor. A numeric watermark is never used.
    expect(hydration.kind).toBe("contract_incompatible")
    expect(calls).toEqual([{ kind: "request", path: "/sessions/ses_1" }])
  })

  it("uses only Last-Event-ID and never a cursor query parameter", async () => {
    const seen: Array<{ path: string; headers?: Readonly<Record<string, string>> }> = []
    const transport: SessionTransport = {
      request: async () => jsonResponse(500, {}),
      stream: async (request) => {
        seen.push(request)
        return { status: 200, headers: new Headers(), body: new ReadableStream() }
      },
    }
    const client = createSessionClient({ transport })
    const handle = client.openEvents({
      sessionId: "ses_1",
      cursor: "signed.opaque.cursor",
      onEvent: () => undefined,
      onConnection: () => undefined,
    })
    await handle.ready
    handle.close()

    expect(seen[0]?.path).toBe("/sessions/ses_1/events")
    expect(seen[0]?.path).not.toContain("?")
    expect(seen[0]?.headers?.["last-event-id"]).toBe("signed.opaque.cursor")
  })

  it("propagates authentication failure as a typed error", async () => {
    const transport: SessionTransport = {
      request: async () => jsonResponse(401, { error: "authentication_required" }),
      stream: async () => ({ status: 500, headers: new Headers(), body: null }),
    }
    const client = createSessionClient({ transport })

    await expect(client.fetchSnapshot("ses_1")).rejects.toMatchObject({
      kind: "auth_required",
      status: 401,
    })
  })

  it("validates command input and preserves its idempotency identity", async () => {
    const bodies: unknown[] = []
    const transport: SessionTransport = {
      request: async (request) => {
        bodies.push(request.body)
        return jsonResponse(202, {
          run_id: "run_1",
          user_message_id: "msg_1",
          assistant_message_id: "msg_2",
        })
      },
      stream: async () => ({ status: 500, headers: new Headers(), body: null }),
    }
    const client = createSessionClient({ transport })

    await client.createMessage("ses_1", {
      idempotency_key: "cmd_1",
      content: "hello",
    })

    expect(bodies).toEqual([{ idempotency_key: "cmd_1", content: "hello" }])
  })
})
