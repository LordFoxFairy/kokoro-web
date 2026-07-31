import { describe, expect, test } from "vitest"

import { createScopedRequestCoordinator } from "../src/scoped-requests"

describe("browser runtime scoped requests", () => {
  test("aborts the old scope and rejects its completion even when an upstream ignores abort", () => {
    const requests = createScopedRequestCoordinator("scope-a")
    const stale = requests.begin("load", "scope-a")
    requests.reset("scope-b")

    expect(stale.signal.aborted).toBe(true)
    expect(stale.isCurrent()).toBe(false)
    expect(requests.isScopeCurrent("scope-a")).toBe(false)
    expect(requests.isScopeCurrent("scope-b")).toBe(true)
  })

  test("uses latest-request-wins per slot and aborts every slot on unmount", () => {
    const requests = createScopedRequestCoordinator("scope-a")
    const firstSelection = requests.begin("selection", "scope-a")
    const refresh = requests.begin("refresh", "scope-a")
    const secondSelection = requests.begin("selection", "scope-a")

    expect(firstSelection.signal.aborted).toBe(true)
    expect(firstSelection.isCurrent()).toBe(false)
    expect(refresh.isCurrent()).toBe(true)
    expect(secondSelection.isCurrent()).toBe(true)

    requests.stop()
    expect(refresh.signal.aborted).toBe(true)
    expect(secondSelection.signal.aborted).toBe(true)
    expect(refresh.isCurrent()).toBe(false)
    expect(secondSelection.isCurrent()).toBe(false)
  })

  test("can re-enter the same scope after React strict-effect cleanup replay", () => {
    const requests = createScopedRequestCoordinator("scope-a")
    requests.stop()

    expect(() => requests.reset("scope-a")).not.toThrow()
    expect(requests.isScopeCurrent("scope-a")).toBe(true)
    expect(requests.begin("bootstrap", "scope-a").isCurrent()).toBe(true)
  })
})
