import type { SessionClient } from "@kokoro/session-client"
import type { CommandIdentity, SessionCommandResponse } from "@kokoro/session-client/contracts"
import { describe, expect, it, vi } from "vitest"

import {
  createSessionCommandRecoveryStore,
  type SessionCommandRecoveryRecord,
  type SessionCommandStorage,
} from "../src/command-recovery.js"
import { reconcileCommandReceipt } from "../src/command.js"

const DIGEST = "a".repeat(64)
const command: CommandIdentity = {
  command_id: "command-12345678",
  idempotency_key: "web:command-12345678",
  digest_algorithm: "SHA256_CANONICAL_JSON_V2",
  request_digest: DIGEST,
}

function storageFixture(): SessionCommandStorage & Pick<Storage, "key" | "length"> & { readonly values: Map<string, string> } {
  const values = new Map<string, string>()
  return {
    values,
    get length() { return values.size },
    key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => void values.delete(key),
  }
}

function record(createdAt = 1_000): SessionCommandRecoveryRecord {
  return {
    schemaVersion: 1,
    operation: "submit_message",
    command,
    sessionId: "session-12345678",
    clientDraftRevision: "draft-revision-12345678",
    createdAt,
  }
}

describe("Session command recovery store", () => {
  it("round-trips only the exact non-secret receipt lookup identity", () => {
    const storage = storageFixture()
    const store = createSessionCommandRecoveryStore({ storage, scope: "browser-scope-alpha", now: () => 2_000 })

    store.save(record())

    expect(store.load()).toEqual(record())
    expect([...storage.values.values()].join("")).not.toContain("prompt")
  })

  it.each([
    ["expired", { ...record(1_000), createdAt: 1_000 }],
    ["unknown operation", { ...record(), operation: "run_execute" }],
    ["unknown field", { ...record(), authority: "browser" }],
    ["draft revision on another operation", { ...record(), operation: "cancel_run" }],
    ["invalid command", { ...record(), command: { ...command, request_digest: "not-a-digest" } }],
  ])("fails closed and removes %s browser state", (_label, value) => {
    const storage = storageFixture()
    const removeItem = vi.spyOn(storage, "removeItem")
    storage.values.set("kokoro.chat.pending-command.v1.browser-scope-alpha", JSON.stringify(value))
    const now = _label === "expired" ? () => 86_402_001 : () => 2_000
    const store = createSessionCommandRecoveryStore({ storage, scope: "browser-scope-alpha", now })

    expect(store.load()).toBeNull()
    expect(removeItem).toHaveBeenCalledOnce()
  })

  it("does not let an older completion clear a newer pending command", () => {
    const storage = storageFixture()
    const store = createSessionCommandRecoveryStore({ storage, scope: "browser-scope-alpha", now: () => 2_000 })
    store.save(record())

    store.clear("different-command")
    expect(store.load()).toEqual(record())

    store.clear(command.command_id)
    expect(store.load()).toBeNull()
  })

  it("isolates recovery by opaque browser runtime scope and prunes a prior account scope", () => {
    const storage = storageFixture()
    const alpha = createSessionCommandRecoveryStore({
      storage,
      scope: "browser-scope-alpha",
      now: () => 2_000,
    })
    alpha.save(record())

    const beta = createSessionCommandRecoveryStore({
      storage,
      scope: "browser-scope-beta",
      pruneOtherScopes: true,
      now: () => 2_000,
    })

    expect(beta.load()).toBeNull()
    expect(alpha.load()).toBeNull()
    expect([...storage.values.keys()]).toEqual([])
  })
})

describe("Session command receipt identity", () => {
  it("rejects a successful receipt that does not echo the requested command identity", async () => {
    const response: SessionCommandResponse = {
      command_receipt: {
        operation: "submit_message",
        command_id: "different-command",
        idempotency_key: command.idempotency_key,
        digest_algorithm: command.digest_algorithm,
        request_digest: command.request_digest,
        updated_at: "2026-07-29T00:00:00.000Z",
        status: "accepted",
        payload: {
          kind: "run-launch-created",
          payload: {
            session_id: "session-12345678",
            branch_id: "branch-12345678",
            trigger_message_id: "message-user-12345678",
            assistant_message_id: "message-assistant-12345678",
            launch_id: "launch-12345678",
            proposed_run_id: "run-12345678",
            session_version: 2,
            branch_version: 2,
          },
        },
      },
    }
    const client = { getCommandReceipt: vi.fn() } satisfies Pick<SessionClient, "getCommandReceipt">

    await expect(reconcileCommandReceipt(client, response, command, "submit_message"))
      .rejects.toThrow("Session command receipt identity mismatch")
    expect(client.getCommandReceipt).not.toHaveBeenCalled()
  })
})
