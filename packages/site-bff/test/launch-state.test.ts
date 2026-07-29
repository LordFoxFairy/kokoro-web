import { describe, expect, it } from "vitest"

import { createLaunchStateVault, type LaunchCommandState } from "../src/launch-state.js"

const binding = {
  siteProjectBindingRef: "binding-12345678",
  deploymentRef: "deployment-12345678",
  siteReleaseRef: "release-12345678",
  webArtifactDigest: "a".repeat(64),
}

function state(index: number): LaunchCommandState {
  return {
    operation: index % 2 === 0 ? "redemption.confirm" : "identity.register",
    flowRef: `launch-flow-${index.toString().padStart(8, "0")}`,
    command: { commandId: index.toString(16).padStart(32, "0"), idempotencyKey: index.toString(16).padStart(48, "0") },
    createdAt: index,
    lastUsedAt: index,
    expiresAt: 10_000,
  }
}

describe("launch command state vault", () => {
  it("seals commands to the immutable deployment binding and detects tamper", () => {
    const vault = createLaunchStateVault({ secret: "s".repeat(64), binding, now: () => 1_000, nonce: () => Buffer.alloc(12, 7) })
    const sealed = vault.seal([state(1)])

    expect(sealed).not.toContain("identity.register")
    expect(vault.open(sealed)).toEqual([state(1)])
    expect(createLaunchStateVault({ secret: "s".repeat(64), binding: { ...binding, deploymentRef: "other-deployment" }, now: () => 1_000, nonce: () => Buffer.alloc(12, 7) }).open(sealed)).toEqual([])
    expect(vault.open(`${sealed.slice(0, -1)}x`)).toEqual([])
  })

  it("keeps eight independent operation/flow entries with expiry cleanup and LRU replacement", () => {
    const vault = createLaunchStateVault({ secret: "s".repeat(64), binding, now: () => 1_000, nonce: () => Buffer.alloc(12, 7) })
    let entries: readonly LaunchCommandState[] = []
    for (let index = 1; index <= 9; index += 1) entries = vault.put(entries, state(index))

    expect(entries).toHaveLength(8)
    expect(entries.some(({ flowRef }) => flowRef === "launch-flow-00000001")).toBe(false)
    expect(vault.find(entries, "identity.register", "launch-flow-00000009")?.command.commandId).toBe("9".padStart(32, "0"))
    expect(vault.clean([{ ...state(2), expiresAt: 999 }, state(3)])).toEqual([state(3)])
  })

  it("never stores redeem Code material", () => {
    const vault = createLaunchStateVault({ secret: "s".repeat(64), binding, now: () => 1_000, nonce: () => Buffer.alloc(12, 7) })
    const sealed = vault.seal([state(1)])
    expect(Buffer.from(sealed).includes(Buffer.from("RAW-REDEEM-CODE"))).toBe(false)
  })

  it("accepts security ceremony state only with a secret command and matching operation", () => {
    const vault = createLaunchStateVault({ secret: "s".repeat(64), binding, now: () => 1_000, nonce: () => Buffer.alloc(12, 7) })
    const security: LaunchCommandState = {
      operation: "identity.enroll-totp",
      flowRef: "security-flow-12345678",
      command: {
        commandId: "a".repeat(32),
        idempotencyKey: "b".repeat(48),
        receiptRecoveryCapability: "c".repeat(64),
      },
      createdAt: 1_000,
      lastUsedAt: 1_000,
      expiresAt: 10_000,
      security: { phase: "reauthenticate_password" },
    }

    expect(vault.open(vault.seal(vault.put([], security)))).toEqual([security])
    expect(() => vault.put([], { ...security, command: { commandId: "a".repeat(32), idempotencyKey: "b".repeat(48) } })).toThrow()
    expect(() => vault.put([], { ...state(1), security: { phase: "reauthenticate_password" } })).toThrow()
  })
})
