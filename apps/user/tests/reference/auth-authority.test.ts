import { describe, expect, it } from "vitest"

import {
  assembleChunkedCookie,
  refreshCredentialIsActive,
  sessionCredentialIsActive,
} from "@/lib/server/auth-authority"

const NOW = Date.parse("2026-07-29T12:00:00.000Z")

describe("Site auth authority expiry", () => {
  it("never treats expired or malformed session credentials as authenticated", () => {
    expect(sessionCredentialIsActive("2026-07-29T11:59:59.999Z", NOW)).toBe(false)
    expect(sessionCredentialIsActive("not-a-date", NOW)).toBe(false)
    expect(sessionCredentialIsActive("2026-07-29T12:00:00.001Z", NOW)).toBe(true)
  })

  it("never attempts refresh with expired or malformed refresh authority", () => {
    expect(refreshCredentialIsActive("2026-07-29T11:59:59.999Z", NOW)).toBe(false)
    expect(refreshCredentialIsActive("not-a-date", NOW)).toBe(false)
    expect(refreshCredentialIsActive("2026-07-29T12:00:00.001Z", NOW)).toBe(true)
  })

  it("reassembles Auth.js session cookie chunks without accepting ambiguous sets", () => {
    const name = "__Host-kokoro.session-token"
    expect(assembleChunkedCookie([{ name, value: "whole" }], name)).toBe("whole")
    expect(assembleChunkedCookie([
      { name: `${name}.1`, value: "tail" },
      { name: `${name}.0`, value: "head" },
    ], name)).toBe("headtail")
    expect(assembleChunkedCookie([
      { name, value: "whole" },
      { name: `${name}.0`, value: "shadow" },
    ], name)).toBeNull()
    expect(assembleChunkedCookie([{ name: `${name}.1`, value: "orphan" }], name)).toBeNull()
  })
})
