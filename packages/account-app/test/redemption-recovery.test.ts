import { describe, expect, it, vi } from "vitest"

import {
  parseRedemptionCommandResult,
  pollRedemptionCommand,
  type RedemptionPendingResult,
} from "../src/redemption-recovery.js"

function pending(
  state: RedemptionPendingResult["state"],
  retryAfter: string,
): RedemptionPendingResult {
  return { state, retryAfter }
}

describe("redemption confirmation recovery", () => {
  it("honors each retryAfter while accepted, executing, and outcome_unknown before succeeding", async () => {
    let now = Date.parse("2026-08-09T12:00:00.000Z")
    const sleeps: number[] = []
    const recover = vi.fn()
      .mockResolvedValueOnce(pending("executing", "2026-08-09T12:00:03.000Z"))
      .mockResolvedValueOnce(pending("outcome_unknown", "2026-08-09T12:00:06.000Z"))
      .mockResolvedValueOnce({
        state: "succeeded",
        productState: "fulfilled",
        redeemedAt: "2026-08-09T12:00:06.000Z",
      })

    const outcome = await pollRedemptionCommand({
      initial: pending("accepted", "2026-08-09T12:00:01.000Z"),
      recover,
      now: () => now,
      sleep: async (delayMs) => { sleeps.push(delayMs); now += delayMs },
    })

    expect(sleeps).toEqual([1_000, 2_000, 3_000])
    expect(recover).toHaveBeenCalledTimes(3)
    expect(outcome).toEqual({
      kind: "terminal",
      result: {
        state: "succeeded",
        productState: "fulfilled",
        redeemedAt: "2026-08-09T12:00:06.000Z",
      },
    })
  })

  it.each([
    [{ state: "rejected", retry: "never" }, "rejected"],
    [{ state: "review_required", expiresAt: "2026-08-10T12:00:00.000Z" }, "review_required"],
  ] as const)("stops at the %s terminal outcome", async (terminal, expectedState) => {
    const now = Date.parse("2026-08-09T12:00:00.000Z")
    const recover = vi.fn().mockResolvedValueOnce(terminal)
    const outcome = await pollRedemptionCommand({
      initial: pending("accepted", "2026-08-09T12:00:00.000Z"),
      recover,
      now: () => now,
      sleep: async () => undefined,
    })

    expect(outcome.kind).toBe("terminal")
    if (outcome.kind === "terminal") expect(outcome.result.state).toBe(expectedState)
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it("stops before a retryAfter outside the bounded recovery window", async () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z")
    const recover = vi.fn()
    const sleep = vi.fn()
    const latest = pending("outcome_unknown", "2026-08-09T12:00:31.000Z")

    await expect(pollRedemptionCommand({
      initial: latest,
      recover,
      now: () => now,
      sleep,
    })).resolves.toEqual({ kind: "interrupted", reason: "timeout", pending: latest })
    expect(recover).not.toHaveBeenCalled()
    expect(sleep).not.toHaveBeenCalled()
  })

  it("does not recover after an event-loop delay has exhausted the bounded window", async () => {
    let now = Date.parse("2026-08-09T12:00:00.000Z")
    const recover = vi.fn()
    const latest = pending("executing", "2026-08-09T12:00:01.000Z")

    await expect(pollRedemptionCommand({
      initial: latest,
      recover,
      now: () => now,
      sleep: async (delayMs) => { now += delayMs + 30_000 },
    })).resolves.toEqual({ kind: "interrupted", reason: "timeout", pending: latest })
    expect(recover).not.toHaveBeenCalled()
  })

  it("returns the latest pending state when the network is interrupted", async () => {
    const now = Date.parse("2026-08-09T12:00:00.000Z")
    const latest = pending("executing", "2026-08-09T12:00:00.000Z")

    await expect(pollRedemptionCommand({
      initial: latest,
      recover: async () => { throw new Error("socket closed") },
      now: () => now,
      sleep: async () => undefined,
    })).resolves.toEqual({ kind: "interrupted", reason: "network", pending: latest })
  })

  it("rejects response shapes outside the existing Account recovery protocol", () => {
    for (const invalid of [
      null,
      { state: "accepted" },
      { state: "accepted", retryAfter: "1" },
      { state: "succeeded", productState: "fulfilled" },
      { state: "succeeded", productState: "fulfilled", redeemedAt: "2026-08-09" },
      { state: "review_required", expiresAt: "not-a-time" },
      { state: "rejected", retry: "same_action" },
      { state: "unknown", retryAfter: "2026-08-09T12:00:00.000Z" },
    ]) expect(() => parseRedemptionCommandResult(invalid)).toThrow("redemption_response_invalid")
  })
})
