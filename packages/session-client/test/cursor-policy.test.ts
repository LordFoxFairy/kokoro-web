import { describe, expect, it } from "vitest"

import { createCursorPolicy } from "../src/cursor-policy.js"

describe("opaque cursor policy", () => {
  const policy = createCursorPolicy()

  it("rejects numeric and empty cursors", () => {
    expect(policy.accept("0")).toEqual({ kind: "contract_incompatible", reason: "numeric_cursor" })
    expect(policy.accept("42")).toEqual({ kind: "contract_incompatible", reason: "numeric_cursor" })
    expect(policy.accept(" ")).toEqual({ kind: "repair_required", reason: "missing_cursor" })
  })

  it("keeps an accepted cursor opaque", () => {
    const result = policy.accept("signed.eyJzZXNzaW9uIjoic2VzXzEifQ.signature")
    expect(result).toEqual({
      kind: "ready",
      cursor: "signed.eyJzZXNzaW9uIjoic2VzXzEifQ.signature",
    })
  })

  it("maps transport cursor rejection to a first-class repair action", () => {
    expect(policy.onRejected(410)).toEqual({ kind: "rehydrate", reason: "cursor_expired" })
    expect(policy.onRejected(409)).toEqual({ kind: "repair_required", reason: "cursor_conflict" })
    expect(policy.onRejected(401)).toEqual({ kind: "reauthenticate", reason: "auth_required" })
  })
})
