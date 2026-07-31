import { describe, expect, it, vi } from "vitest"

import type { SessionCommandRecoveryRecord, SessionCommandRecoveryStore } from "../src/command-recovery.js"
import { createSessionContextCoordinator } from "../src/session-context-coordinator.js"

function recoveryRecord(commandId: string, sessionId: string): SessionCommandRecoveryRecord {
  return {
    schemaVersion: 1,
    operation: "submit_message",
    command: {
      command_id: commandId,
      idempotency_key: `web:${commandId}`,
      digest_algorithm: "SHA256_CANONICAL_JSON_V2",
      request_digest: "a".repeat(64),
    },
    sessionId,
    createdAt: 1_000,
  }
}

describe("Session context coordinator", () => {
  it("keeps the first owner policy immutable for each Session ID", () => {
    const coordinator = createSessionContextCoordinator({})

    expect(coordinator.observe("session-a", "standard")).toEqual({
      kind: "accepted",
      contextPolicy: "standard",
    })
    expect(coordinator.observe("session-a", "temporary")).toEqual({
      kind: "mismatch",
      expectedContextPolicy: "standard",
      receivedContextPolicy: "temporary",
    })
    expect(coordinator.observe("session-b", "temporary")).toEqual({
      kind: "accepted",
      contextPolicy: "temporary",
    })
  })

  it("defers persisted standard recovery without discarding a temporary in-memory identity", () => {
    const persisted = recoveryRecord("command-standard-12345678", "session-standard")
    const temporary = recoveryRecord("command-temporary-12345678", "session-temporary")
    const store = {
      load: vi.fn(() => persisted),
      save: vi.fn(),
      clear: vi.fn(),
    } satisfies SessionCommandRecoveryStore
    const coordinator = createSessionContextCoordinator({ commandRecoveryStore: store })

    coordinator.observe("session-temporary", "temporary")
    expect(coordinator.getPendingCommand()).toBeNull()

    coordinator.remember(temporary, "temporary")
    expect(coordinator.getPendingCommand()).toBe(temporary)
    expect(store.save).not.toHaveBeenCalled()
    coordinator.forget(temporary.command.command_id)
    expect(store.clear).not.toHaveBeenCalled()

    coordinator.observe("session-standard", "standard")
    expect(coordinator.getPendingCommand()).toBe(persisted)
  })
})
