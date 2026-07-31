// @vitest-environment happy-dom

import { createMemoryCommandJournal, type MemoryBrowserFetch } from "../src/memory-controller"
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"

import { MemoryProduct } from "../src/memory-product"

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.sessionStorage.clear()
})

const settings = {
  automaticLearning: { availability: "unavailable_until_memory_m3", effective: false, policyReason: null, requested: false },
  observedAt: "2026-07-31T00:00:00.000Z",
  pastChatReference: { availability: "unavailable_until_session_m1a", effective: false, policyReason: null, requested: false },
  revision: "1",
  savedMemoryUse: { availability: "available", effective: true, policyReason: null, requested: true },
} as const

function responseFor(input: string | URL | Request, content: string): Response {
  const path = String(input)
  if (path.endsWith("/settings")) return Response.json(settings)
  if (path.includes("/entries?")) return Response.json({
    items: [{
      category: "preference",
      content,
      createdAt: "2026-07-31T00:00:00.000Z",
      currentRevisionRef: "revision-1",
      entryRef: "entry-1",
      entryVersion: "1",
      prioritized: false,
      revision: 1,
      scopeKind: "user",
      source: { safeLabel: "Saved by you", sourceKind: "explicit", state: "current" },
      state: "active",
      updatedAt: "2026-07-31T00:00:00.000Z",
      validFrom: null,
      validTo: null,
    }],
    ownerSnapshot: { snapshotRef: "snapshot:response-for:1", spaceVersion: "1" },
    pageInfo: { hasMore: false, nextCursor: null },
  })
  throw new Error(`Unexpected Memory request: ${path}`)
}

function immediateFetch(content: string): MemoryBrowserFetch {
  return (input) => Promise.resolve(responseFor(input, content))
}

function entryValue(entryRef: string, content: string, overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    category: "preference",
    content,
    createdAt: "2026-07-31T00:00:00.000Z",
    currentRevisionRef: `${entryRef}-revision-1`,
    entryRef,
    entryVersion: "1",
    prioritized: false,
    revision: 1,
    scopeKind: "user",
    source: { safeLabel: "Saved by you", sourceKind: "explicit", state: "current" },
    state: "active",
    updatedAt: "2026-07-31T00:00:00.000Z",
    validFrom: null,
    validTo: null,
    ...overrides,
  }
}

function entryResponse(entryRef: string, content: string, observedSpaceVersion: string, overrides: Readonly<Record<string, unknown>> = {}): Response {
  return Response.json({ entry: entryValue(entryRef, content, overrides), observedSpaceVersion })
}

function historyResponse(entryRef: string, spaceVersion = "1"): Response {
  return Response.json({
    entryRef,
    items: [],
    ownerSnapshot: { snapshotRef: `history-snapshot:${entryRef}:${spaceVersion}`, spaceVersion },
    pageInfo: { hasMore: false, nextCursor: null },
  })
}

describe("Memory product runtime scope", () => {
  test("renders a new scope from an empty keyed runtime before the new owner read settles", async () => {
    const scopeAFetch = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/entries/entry-1")) {
        return Promise.resolve(Response.json({
          entry: entryValue("entry-1", "Private scope A detail", {
            currentRevisionRef: "entry-1-revision-2",
            entryVersion: "2",
            revision: 2,
            updatedAt: "2026-07-31T00:00:02.000Z",
          }),
          observedSpaceVersion: "1",
        }))
      }
      if (path.includes("/entries/entry-1/history")) {
        return Promise.resolve(Response.json({
          entryRef: "entry-1",
          items: [{
            content: "Private scope A history",
            reason: "explicit",
            recordedAt: "2026-07-31T00:00:00.000Z",
            restorable: true,
            revision: 1,
            revisionRef: "scope-a-revision-1",
            state: "available",
            supersedesRevisionRef: null,
            validFrom: null,
            validTo: null,
          }],
          ownerSnapshot: { snapshotRef: "history-snapshot:scope-a:1", spaceVersion: "1" },
          pageInfo: { hasMore: false, nextCursor: null },
        }))
      }
      return Promise.resolve(responseFor(input, "Private scope A memory"))
    })
    const rendered = render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-a"
      fetch={scopeAFetch}
    />)
    fireEvent.click(await screen.findByRole("button", { name: /Private scope A memory/ }))
    expect(await screen.findAllByText("Private scope A detail")).toHaveLength(2)
    expect(await screen.findByText("Private scope A history")).toBeTruthy()

    const deferredB = vi.fn<MemoryBrowserFetch>(() => new Promise<Response>(() => undefined))
    rendered.rerender(<MemoryProduct
      brandName="Site B"
      browserRuntimeScope="site-b:user-2:release-1"
      csrfToken="csrf-b"
      fetch={deferredB}
    />)

    expect(screen.queryByText("Private scope A memory")).toBeNull()
    expect(screen.queryAllByText("Private scope A detail")).toHaveLength(0)
    expect(screen.queryByText("Private scope A history")).toBeNull()
    expect(screen.queryByRole("button", { name: /Private scope A memory/ })).toBeNull()
  })

  test("restarts the first page when an initial deep link observes a newer owner version", async () => {
    const stale = entryValue("entry-stale", "Unobserved stale owner plaintext")
    const current = entryValue("entry-1", "Current deep-link owner", {
      currentRevisionRef: "entry-1-revision-2",
      entryVersion: "2",
      revision: 2,
      updatedAt: "2026-07-31T00:00:02.000Z",
    })
    let listCalls = 0
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?") && !path.includes("history")) {
        listCalls += 1
        return Promise.resolve(Response.json(listCalls === 1
          ? {
              items: [stale],
              ownerSnapshot: { snapshotRef: "snapshot:before-deep-link", spaceVersion: "1" },
              pageInfo: { hasMore: false, nextCursor: null },
            }
          : {
              items: [current],
              ownerSnapshot: { snapshotRef: "snapshot:after-deep-link", spaceVersion: "2" },
              pageInfo: { hasMore: false, nextCursor: null },
            }))
      }
      if (path.endsWith("/entries/entry-1")) {
        return Promise.resolve(Response.json({ entry: current, observedSpaceVersion: "2" }))
      }
      if (path.includes("/entries/entry-1/history")) return Promise.resolve(historyResponse("entry-1", "2"))
      throw new Error(`Unexpected Memory request: ${path}`)
    })

    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
      initialEntryRef="entry-1"
    />)

    expect(await screen.findAllByText("Current deep-link owner")).toHaveLength(2)
    expect(listCalls).toBe(2)
    expect(screen.queryByText("Unobserved stale owner plaintext")).toBeNull()
  })

  test("ignores deferred A results after committed A to B to A rerenders", async () => {
    const releases: Array<() => void> = []
    const oldA = vi.fn<MemoryBrowserFetch>((input) => new Promise<Response>((resolve) => {
      releases.push(() => resolve(responseFor(input, "Stale A memory")))
    }))
    const rendered = render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-a-old"
      fetch={oldA}
    />)
    await waitFor(() => expect(oldA).toHaveBeenCalledTimes(2))

    rendered.rerender(<MemoryProduct
      brandName="Site B"
      browserRuntimeScope="site-b:user-1:release-1"
      csrfToken="csrf-b"
      fetch={immediateFetch("Site B memory")}
    />)
    expect(await screen.findByText("Site B memory")).toBeTruthy()

    rendered.rerender(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-a-new"
      fetch={immediateFetch("Current A memory")}
    />)
    expect(await screen.findByText("Current A memory")).toBeTruthy()

    await act(async () => {
      for (const release of releases) release()
      await Promise.resolve()
    })

    expect(screen.queryByText("Stale A memory")).toBeNull()
    expect(screen.getByText("Current A memory")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("ignores deferred results after a same-scope committed auth client rotation", async () => {
    const releases: Array<() => void> = []
    const oldClient = vi.fn<MemoryBrowserFetch>((input) => new Promise<Response>((resolve) => {
      releases.push(() => resolve(responseFor(input, "Stale auth client memory")))
    }))
    const rendered = render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-before-rotation"
      fetch={oldClient}
    />)
    await waitFor(() => expect(oldClient).toHaveBeenCalledTimes(2))

    rendered.rerender(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-after-rotation"
      fetch={immediateFetch("Current auth client memory")}
    />)
    expect(await screen.findByText("Current auth client memory")).toBeTruthy()

    await act(async () => {
      for (const release of releases) release()
      await Promise.resolve()
    })

    expect(screen.queryByText("Stale auth client memory")).toBeNull()
    expect(screen.getByText("Current auth client memory")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("ignores a deferred deep-link A result after same-scope A to B to A navigation", async () => {
    const releases: Array<() => void> = []
    let aEntryCalls = 0
    let aHistoryCalls = 0
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) {
        return Promise.resolve(Response.json({
          items: [],
          ownerSnapshot: { snapshotRef: "snapshot:deep-link:1", spaceVersion: "1" },
          pageInfo: { hasMore: false, nextCursor: null },
        }))
      }
      if (path.includes("/entries/entry-a/history")) {
        aHistoryCalls += 1
        if (aHistoryCalls === 1) {
          return new Promise<Response>((resolve) => releases.push(() => resolve(historyResponse("entry-a"))))
        }
        return Promise.resolve(historyResponse("entry-a"))
      }
      if (path.endsWith("/entries/entry-a")) {
        aEntryCalls += 1
        if (aEntryCalls === 1) {
          return new Promise<Response>((resolve) => releases.push(() => resolve(entryResponse("entry-a", "Stale deep-link A", "1"))))
        }
        return Promise.resolve(entryResponse("entry-a", "Current deep-link A", "1"))
      }
      if (path.includes("/entries/entry-b/history")) return Promise.resolve(historyResponse("entry-b"))
      if (path.endsWith("/entries/entry-b")) return Promise.resolve(entryResponse("entry-b", "Current deep-link B", "1"))
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    const rendered = render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
      initialEntryRef="entry-a"
    />)
    await waitFor(() => expect(releases).toHaveLength(2))

    rendered.rerender(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
      initialEntryRef="entry-b"
    />)
    expect(await screen.findByText("Current deep-link B")).toBeTruthy()

    rendered.rerender(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
      initialEntryRef="entry-a"
    />)
    expect(await screen.findByText("Current deep-link A")).toBeTruthy()
    await act(async () => {
      for (const release of releases) release()
      await Promise.resolve()
    })

    expect(screen.queryByText("Stale deep-link A")).toBeNull()
    expect(screen.getByText("Current deep-link A")).toBeTruthy()
  })

  test("does not project a stale selection error after a newer entry is selected", async () => {
    let rejectEntryA!: () => void
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [entryValue("entry-a", "Memory A"), entryValue("entry-b", "Memory B")],
        ownerSnapshot: { snapshotRef: "snapshot:selection:2", spaceVersion: "2" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.includes("/entries/entry-a/history")) return Promise.resolve(historyResponse("entry-a"))
      if (path.endsWith("/entries/entry-a")) {
        return new Promise<Response>((_resolve, reject) => {
          rejectEntryA = () => reject(new Error("stale entry A failure"))
        })
      }
      if (path.includes("/entries/entry-b/history")) return Promise.resolve(historyResponse("entry-b", "2"))
      if (path.endsWith("/entries/entry-b")) return Promise.resolve(entryResponse("entry-b", "Current detail B", "2", {
        currentRevisionRef: "entry-b-revision-2",
        entryVersion: "2",
        revision: 2,
        updatedAt: "2026-07-31T00:00:02.000Z",
      }))
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)
    const entryA = await screen.findByRole("button", { name: /Memory A/ })
    const entryB = screen.getByRole("button", { name: /Memory B/ })

    act(() => {
      entryA.click()
      entryB.click()
    })
    expect(await screen.findAllByText("Current detail B")).toHaveLength(2)
    await act(async () => {
      rejectEntryA()
      await Promise.resolve()
    })

    expect(screen.getAllByText("Current detail B")).toHaveLength(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("does not project a stale history-page error after selection advances", async () => {
    let rejectHistoryA!: () => void
    let historyACalls = 0
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [entryValue("entry-a", "Memory A"), entryValue("entry-b", "Memory B")],
        ownerSnapshot: { snapshotRef: "snapshot:history-selection:2", spaceVersion: "2" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.includes("/entries/entry-a/history")) {
        historyACalls += 1
        if (historyACalls === 1) return Promise.resolve(Response.json({
          entryRef: "entry-a",
          items: [],
          ownerSnapshot: { snapshotRef: "history-snapshot:entry-a:2", spaceVersion: "2" },
          pageInfo: { hasMore: true, nextCursor: "history-a-next" },
        }))
        return new Promise<Response>((_resolve, reject) => {
          rejectHistoryA = () => reject(new Error("stale history A failure"))
        })
      }
      if (path.endsWith("/entries/entry-a")) return Promise.resolve(entryResponse("entry-a", "Current detail A", "2", {
        currentRevisionRef: "entry-a-revision-2",
        entryVersion: "2",
        revision: 2,
        updatedAt: "2026-07-31T00:00:02.000Z",
      }))
      if (path.includes("/entries/entry-b/history")) return Promise.resolve(historyResponse("entry-b", "2"))
      if (path.endsWith("/entries/entry-b")) return Promise.resolve(entryResponse("entry-b", "Current detail B", "2", {
        currentRevisionRef: "entry-b-revision-2",
        entryVersion: "2",
        revision: 2,
        updatedAt: "2026-07-31T00:00:02.000Z",
      }))
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)
    fireEvent.click(await screen.findByRole("button", { name: /Memory A/ }))
    expect(await screen.findAllByText("Current detail A")).toHaveLength(2)

    act(() => {
      screen.getByRole("button", { name: "Load more history" }).click()
      screen.getByRole("button", { name: /Memory B/ }).click()
    })
    expect(await screen.findAllByText("Current detail B")).toHaveLength(2)
    await act(async () => {
      rejectHistoryA()
      await Promise.resolve()
    })

    expect(screen.getAllByText("Current detail B")).toHaveLength(2)
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("clears plaintext history and performs one bounded reload when its owner snapshot changes", async () => {
    const selected = entryValue("entry-1", "Current history owner")
    let firstPageCalls = 0
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?") && !path.includes("history")) return Promise.resolve(Response.json({
        items: [selected],
        ownerSnapshot: { snapshotRef: "snapshot:list", spaceVersion: "1" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.endsWith("/entries/entry-1")) return Promise.resolve(Response.json({ entry: selected, observedSpaceVersion: "1" }))
      if (path.includes("cursor=history-next")) return Promise.resolve(Response.json({
        entryRef: "entry-1",
        items: [],
        ownerSnapshot: { snapshotRef: "history-snapshot:changed", spaceVersion: "1" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.includes("/entries/entry-1/history")) {
        firstPageCalls += 1
        return Promise.resolve(Response.json({
          entryRef: "entry-1",
          items: firstPageCalls === 1 ? [{
            content: "Sensitive old revision",
            reason: "explicit",
            recordedAt: "2026-07-31T00:00:00.000Z",
            restorable: true,
            revision: 1,
            revisionRef: "revision-old",
            state: "available",
            supersedesRevisionRef: null,
            validFrom: null,
            validTo: null,
          }] : [],
          ownerSnapshot: { snapshotRef: firstPageCalls === 1 ? "history-snapshot:initial" : "history-snapshot:reloaded", spaceVersion: "1" },
          pageInfo: { hasMore: firstPageCalls === 1, nextCursor: firstPageCalls === 1 ? "history-next" : null },
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)

    fireEvent.click(await screen.findByRole("button", { name: /Current history owner/ }))
    expect(await screen.findByText("Sensitive old revision")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Load more history" }))

    await waitFor(() => expect(firstPageCalls).toBe(2))
    expect(screen.queryByText("Sensitive old revision")).toBeNull()
    expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull()
  })

  test("clears owner plaintext and performs one bounded first-page recovery after cursor invalidation", async () => {
    const sensitive = entryValue("entry-1", "Sensitive cursor-bound memory")
    let firstPageCalls = 0
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("cursor=invalid-owner-cursor")) {
        return Promise.resolve(Response.json({
          error: { code: "PAGE_CURSOR_INVALID", message: "Owner snapshot changed" },
        }, { status: 409 }))
      }
      if (path.includes("/entries?")) {
        firstPageCalls += 1
        return Promise.resolve(Response.json(firstPageCalls === 1
          ? {
              items: [sensitive],
              ownerSnapshot: { snapshotRef: "snapshot:cursor-before", spaceVersion: "1" },
              pageInfo: { hasMore: true, nextCursor: "invalid-owner-cursor" },
            }
          : {
              items: [],
              ownerSnapshot: { snapshotRef: "snapshot:cursor-after", spaceVersion: "2" },
              pageInfo: { hasMore: false, nextCursor: null },
            }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })

    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)

    expect(await screen.findByText("Sensitive cursor-bound memory")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Load more memories" }))

    await waitFor(() => expect(firstPageCalls).toBe(2))
    expect(screen.queryByText("Sensitive cursor-bound memory")).toBeNull()
    expect(screen.queryByRole("button", { name: "Load more memories" })).toBeNull()
  })

  test("reports an exact recovered rejection and removes its completed journal record", async () => {
    const scope = "site-a:user-1:release-1"
    const commandId = "d".repeat(32)
    createMemoryCommandJournal({ storage: window.localStorage, scope }).remember({
      commandId,
      commandKind: "resetMemorySpace",
      createdAt: new Date().toISOString(),
      targetRef: null,
    })
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith(`/commands/${commandId}`)) {
        return Promise.resolve(Response.json({
          command: {
            commandId,
            commandKind: "resetMemorySpace",
            receiptRef: "receipt-reset-1",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          rejection: {
            code: "policy_rejected",
            retryAfter: null,
            retryClass: "after_user_action",
          },
          state: "rejected",
        }))
      }
      return Promise.resolve(responseFor(input, "Current memory"))
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope={scope}
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)

    fireEvent.click(await screen.findByRole("button", { name: "Recover outcome" }))

    expect((await screen.findByRole("alert")).textContent).toContain("policy_rejected")
    expect(screen.queryByText("Command recovery is still pending")).toBeNull()
    expect(createMemoryCommandJournal({ storage: window.localStorage, scope }).list()).toEqual([])
  })

  test("fails closed when exact command recovery returns mismatched command semantics", async () => {
    const scope = "site-a:user-1:release-1"
    const commandId = "c".repeat(32)
    createMemoryCommandJournal({ storage: window.localStorage, scope }).remember({
      commandId,
      commandKind: "resetMemorySpace",
      createdAt: new Date().toISOString(),
      targetRef: null,
    })
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith(`/commands/${commandId}`)) {
        return Promise.resolve(Response.json({
          command: {
            commandId,
            commandKind: "rememberMemoryEntry",
            receiptRef: "receipt-wrong-kind-1",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "1",
          result: { entry: entryValue("entry-wrong", "Must not be projected"), resultKind: "entry" },
          state: "succeeded",
        }))
      }
      return Promise.resolve(responseFor(input, "Current memory"))
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope={scope}
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)

    fireEvent.click(await screen.findByRole("button", { name: "Recover outcome" }))

    expect((await screen.findByRole("alert")).textContent).toContain("invalid")
    expect(screen.queryByText("Must not be projected")).toBeNull()
    expect(createMemoryCommandJournal({ storage: window.localStorage, scope }).list()).toMatchObject([{
      commandId,
      commandKind: "resetMemorySpace",
    }])
  })

  test("does not let an old list page repopulate memory after reset commits", async () => {
    let releasePage!: () => void
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("cursor=cursor-before-reset")) {
        return new Promise<Response>((resolve) => {
          releasePage = () => resolve(Response.json({
            items: [entryValue("entry-stale", "Stale paged memory")],
            ownerSnapshot: { snapshotRef: "snapshot:before-reset", spaceVersion: "1" },
            pageInfo: { hasMore: false, nextCursor: null },
          }))
        })
      }
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [entryValue("entry-1", "Current memory")],
        ownerSnapshot: { snapshotRef: "snapshot:before-reset", spaceVersion: "1" },
        pageInfo: { hasMore: true, nextCursor: "cursor-before-reset" },
      }))
      if (path.endsWith("/reset")) {
        const body = JSON.parse(String(init?.body)) as { command: { commandId: string } }
        return Promise.resolve(Response.json({
          command: {
            commandId: body.command.commandId,
            commandKind: "resetMemorySpace",
            receiptRef: "receipt-reset-overlap",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "2",
          result: {
            effectiveAt: "2026-07-31T00:00:01.000Z",
            entryRef: null,
            purgeReceiptRef: "purge-reset-overlap",
            purgeScope: "space",
            purgeState: "revoked_purge_pending",
            resultKind: "purge",
          },
          state: "succeeded",
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)
    const confirmation = await screen.findByRole("textbox", { name: "Type RESET ALL MEMORY" })
    fireEvent.change(confirmation, { target: { value: "RESET ALL MEMORY" } })
    const loadMore = screen.getByRole("button", { name: "Load more memories" })
    const reset = screen.getByRole("button", { name: "Reset all memory" })

    act(() => {
      loadMore.click()
      reset.click()
    })
    expect(await screen.findByText("purge-reset-overlap")).toBeTruthy()
    await act(async () => {
      releasePage()
      await Promise.resolve()
    })

    expect(screen.queryByText("Stale paged memory")).toBeNull()
    expect(screen.queryByRole("button", { name: "Load more memories" })).toBeNull()
  })

  test("does not project an old list error after reset advances the read epoch", async () => {
    let rejectPage!: () => void
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("cursor=cursor-before-reset-error")) {
        return new Promise<Response>((_resolve, reject) => {
          rejectPage = () => reject(new Error("stale list failure"))
        })
      }
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [entryValue("entry-1", "Current memory")],
        ownerSnapshot: { snapshotRef: "snapshot:before-reset-error", spaceVersion: "1" },
        pageInfo: { hasMore: true, nextCursor: "cursor-before-reset-error" },
      }))
      if (path.endsWith("/reset")) {
        const body = JSON.parse(String(init?.body)) as { command: { commandId: string } }
        return Promise.resolve(Response.json({
          command: {
            commandId: body.command.commandId,
            commandKind: "resetMemorySpace",
            receiptRef: "receipt-reset-error",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "2",
          result: {
            effectiveAt: "2026-07-31T00:00:01.000Z",
            entryRef: null,
            purgeReceiptRef: "purge-reset-error",
            purgeScope: "space",
            purgeState: "revoked_purge_pending",
            resultKind: "purge",
          },
          state: "succeeded",
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)
    const confirmation = await screen.findByRole("textbox", { name: "Type RESET ALL MEMORY" })
    fireEvent.change(confirmation, { target: { value: "RESET ALL MEMORY" } })

    act(() => {
      screen.getByRole("button", { name: "Load more memories" }).click()
      screen.getByRole("button", { name: "Reset all memory" }).click()
    })
    expect(await screen.findByText("purge-reset-error")).toBeTruthy()
    await act(async () => {
      rejectPage()
      await Promise.resolve()
    })

    expect(screen.getByText("purge-reset-error")).toBeTruthy()
    expect(screen.queryByRole("alert")).toBeNull()
  })

  test("does not let old selected detail or history settle after reset commits", async () => {
    const releases: Array<() => void> = []
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [entryValue("entry-1", "Current memory")],
        ownerSnapshot: { snapshotRef: "snapshot:before-reset-selection", spaceVersion: "1" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.includes("/entries/entry-1/history")) {
        return new Promise<Response>((resolve) => releases.push(() => resolve(Response.json({
          entryRef: "entry-1",
          items: [{
            content: "Stale historical content",
            reason: "explicit",
            recordedAt: "2026-07-30T00:00:00.000Z",
            restorable: true,
            revision: 1,
            revisionRef: "revision-stale-1",
            state: "available",
            supersedesRevisionRef: null,
            validFrom: null,
            validTo: null,
          }],
          ownerSnapshot: { snapshotRef: "history-snapshot:entry-1:1", spaceVersion: "1" },
          pageInfo: { hasMore: false, nextCursor: null },
        }))))
      }
      if (path.endsWith("/entries/entry-1")) {
        return new Promise<Response>((resolve) => releases.push(() => resolve(entryResponse("entry-1", "Stale selected content", "1"))))
      }
      if (path.endsWith("/reset")) {
        const body = JSON.parse(String(init?.body)) as { command: { commandId: string } }
        return Promise.resolve(Response.json({
          command: {
            commandId: body.command.commandId,
            commandKind: "resetMemorySpace",
            receiptRef: "receipt-reset-selection",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "2",
          result: {
            effectiveAt: "2026-07-31T00:00:01.000Z",
            entryRef: null,
            purgeReceiptRef: "purge-reset-selection",
            purgeScope: "space",
            purgeState: "revoked_purge_pending",
            resultKind: "purge",
          },
          state: "succeeded",
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)
    const memory = await screen.findByRole("button", { name: /Current memory/ })
    const confirmation = screen.getByRole("textbox", { name: "Type RESET ALL MEMORY" })
    fireEvent.change(confirmation, { target: { value: "RESET ALL MEMORY" } })
    const reset = screen.getByRole("button", { name: "Reset all memory" })

    act(() => {
      memory.click()
      reset.click()
    })
    expect(await screen.findByText("purge-reset-selection")).toBeTruthy()
    await act(async () => {
      for (const release of releases) release()
      await Promise.resolve()
    })

    expect(screen.queryByText("Stale selected content")).toBeNull()
    expect(screen.queryByText("Stale historical content")).toBeNull()
  })

  test("does not let an overlapping detail read repopulate an entry after forget commits", async () => {
    const releases: Array<() => void> = []
    let deferSelection = false
    const activeEntry = entryValue("entry-1", "Forget overlap memory")
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [activeEntry],
        ownerSnapshot: { snapshotRef: "snapshot:before-forget-overlap", spaceVersion: "1" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.includes("/entries/entry-1/history")) {
        if (deferSelection) return new Promise<Response>((resolve) => releases.push(() => resolve(historyResponse("entry-1"))))
        return Promise.resolve(historyResponse("entry-1"))
      }
      if (path.endsWith("/entries/entry-1")) {
        if (deferSelection) return new Promise<Response>((resolve) => releases.push(() => resolve(entryResponse("entry-1", "Stale forgotten detail", "1"))))
        return Promise.resolve(Response.json({ entry: activeEntry, observedSpaceVersion: "1" }))
      }
      if (path.endsWith("/entries/entry-1/forget")) {
        const body = JSON.parse(String(init?.body)) as { command: { commandId: string } }
        return Promise.resolve(Response.json({
          command: {
            commandId: body.command.commandId,
            commandKind: "forgetMemoryEntry",
            receiptRef: "receipt-forget-overlap",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "2",
          result: {
            effectiveAt: "2026-07-31T00:00:01.000Z",
            entryRef: "entry-1",
            purgeReceiptRef: "purge-forget-overlap",
            purgeScope: "entry",
            purgeState: "revoked_purge_pending",
            resultKind: "purge",
          },
          state: "succeeded",
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct brandName="Site A" browserRuntimeScope="site-a:user-1:release-1" csrfToken="csrf-stable" fetch={fetcher} />)
    const memory = await screen.findByRole("button", { name: /Forget overlap memory/ })
    fireEvent.click(memory)
    const confirmation = await screen.findByRole("textbox", { name: "Type FORGET" })
    fireEvent.change(confirmation, { target: { value: "FORGET" } })
    const forget = screen.getByRole("button", { name: "Forget permanently" })
    deferSelection = true

    act(() => {
      memory.click()
      forget.click()
    })
    expect(await screen.findByText("purge-forget-overlap")).toBeTruthy()
    await act(async () => {
      for (const release of releases) release()
      await Promise.resolve()
    })

    expect(screen.getByText("purge-forget-overlap")).toBeTruthy()
    expect(screen.queryByText("Stale forgotten detail")).toBeNull()
    expect(screen.queryByRole("button", { name: /Forget overlap memory/ })).toBeNull()
  })

  test("keeps a forgotten entry revoked when a later same-scope page still contains it", async () => {
    const staleEntry = entryValue("entry-1", "Forgotten paged memory")
    let initialListCalls = 0
    const initialFetch = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?") && !path.includes("cursor=")) {
        initialListCalls += 1
        return Promise.resolve(Response.json(initialListCalls === 1
          ? { items: [staleEntry], ownerSnapshot: { snapshotRef: "snapshot:before-forget", spaceVersion: "1" }, pageInfo: { hasMore: false, nextCursor: null } }
          : { items: [], ownerSnapshot: { snapshotRef: "snapshot:after-forget", spaceVersion: "2" }, pageInfo: { hasMore: false, nextCursor: null } }))
      }
      if (path.endsWith("/entries/entry-1")) return Promise.resolve(Response.json({ entry: staleEntry, observedSpaceVersion: "1" }))
      if (path.includes("/entries/entry-1/history")) return Promise.resolve(historyResponse("entry-1"))
      if (path.endsWith("/entries/entry-1/forget")) {
        const body = JSON.parse(String(init?.body)) as { command: { commandId: string } }
        return Promise.resolve(Response.json({
          command: {
            commandId: body.command.commandId,
            commandKind: "forgetMemoryEntry",
            receiptRef: "receipt-forget-paged",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "2",
          result: {
            effectiveAt: "2026-07-31T00:00:01.000Z",
            entryRef: "entry-1",
            purgeReceiptRef: "purge-forget-paged",
            purgeScope: "entry",
            purgeState: "revoked_purge_pending",
            resultKind: "purge",
          },
          state: "succeeded",
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    const rendered = render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-before-forget"
      fetch={initialFetch}
    />)

    fireEvent.click(await screen.findByRole("button", { name: /Forgotten paged memory/ }))
    fireEvent.change(await screen.findByRole("textbox", { name: "Type FORGET" }), { target: { value: "FORGET" } })
    fireEvent.click(screen.getByRole("button", { name: "Forget permanently" }))
    expect(await screen.findByText("purge-forget-paged")).toBeTruthy()
    await waitFor(() => expect(initialListCalls).toBe(2))

    let rotatedListCalls = 0
    const rotatedFetch = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("cursor=after-forget")) {
        return Promise.resolve(Response.json({
          items: [staleEntry],
          ownerSnapshot: { snapshotRef: "snapshot:rotated", spaceVersion: "2" },
          pageInfo: { hasMore: false, nextCursor: null },
        }))
      }
      if (path.includes("/entries?")) {
        rotatedListCalls += 1
        return Promise.resolve(Response.json({
          items: [],
          ownerSnapshot: { snapshotRef: rotatedListCalls === 1 ? "snapshot:rotated" : "snapshot:recovered", spaceVersion: "2" },
          pageInfo: { hasMore: rotatedListCalls === 1, nextCursor: rotatedListCalls === 1 ? "after-forget" : null },
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    rendered.rerender(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-after-forget"
      fetch={rotatedFetch}
    />)

    fireEvent.click(await screen.findByRole("button", { name: "Load more memories" }))
    await waitFor(() => expect(rotatedFetch).toHaveBeenCalledTimes(4))
    expect(screen.queryByRole("button", { name: /Forgotten paged memory/ })).toBeNull()
    expect(screen.queryByRole("button", { name: "Load more memories" })).toBeNull()
    expect(rotatedListCalls).toBe(2)
  })

  test("does not regress a confirmed priority version when its refresh page is stale", async () => {
    let listCalls = 0
    const stale = entryValue("entry-1", "Priority memory", {
      currentRevisionRef: "revision-2",
      entryVersion: "2",
      revision: 2,
    })
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("cursor=cursor-before-priority")) {
        listCalls += 1
        return Promise.resolve(Response.json({
          items: [],
          ownerSnapshot: { snapshotRef: "snapshot:priority:2", spaceVersion: "2" },
          pageInfo: { hasMore: false, nextCursor: null },
        }))
      }
      if (path.includes("/entries?")) {
        listCalls += 1
        return Promise.resolve(Response.json({
          items: [stale],
          ownerSnapshot: { snapshotRef: "snapshot:priority:2", spaceVersion: "2" },
          pageInfo: { hasMore: true, nextCursor: listCalls === 1 ? "cursor-before-priority" : "cursor-from-stale-page" },
        }))
      }
      if (path.endsWith("/entries/entry-1")) return Promise.resolve(Response.json({ entry: stale, observedSpaceVersion: "2" }))
      if (path.includes("/entries/entry-1/history")) return Promise.resolve(historyResponse("entry-1", "2"))
      if (path.endsWith("/entries/entry-1/prioritize")) {
        const body = JSON.parse(String(init?.body)) as { command: { commandId: string } }
        return Promise.resolve(Response.json({
          command: {
            commandId: body.command.commandId,
            commandKind: "prioritizeMemoryEntry",
            receiptRef: "receipt-priority-1",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "3",
          result: {
            entry: entryValue("entry-1", "Priority memory", {
              currentRevisionRef: "revision-2",
              entryVersion: "3",
              prioritized: true,
              revision: 2,
            }),
            resultKind: "entry",
          },
          state: "succeeded",
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
      initialEntryRef="entry-1"
    />)

    fireEvent.click(await screen.findByRole("button", { name: "Prioritize" }))
    await waitFor(() => expect(listCalls).toBe(2))

    expect(screen.getByRole("button", { name: "Remove priority" })).toBeTruthy()
    expect(screen.getByRole("button", { name: /Preference · Priority.*Priority memory/ })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Load more memories" })).toBeNull()
    expect(listCalls).toBe(2)
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("cursor=cursor-before-priority"))).toBe(false)
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("cursor=cursor-from-stale-page"))).toBe(false)
  })

  test("shows the reset purge receipt and keeps exact recovery while physical purge is pending", async () => {
    let resetCommandId = ""
    const scope = "site-a:user-1:release-1"
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [],
        ownerSnapshot: { snapshotRef: "snapshot:before-reset-purge", spaceVersion: "1" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.endsWith("/reset")) {
        const body = JSON.parse(String(init?.body)) as { command: { commandId: string } }
        resetCommandId = body.command.commandId
        return Promise.resolve(Response.json({
          command: {
            commandId: resetCommandId,
            commandKind: "resetMemorySpace",
            receiptRef: "receipt-reset-1",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "2",
          result: {
            effectiveAt: "2026-07-31T00:00:01.000Z",
            entryRef: null,
            purgeReceiptRef: "purge-space-1",
            purgeScope: "space",
            purgeState: "revoked_purge_pending",
            resultKind: "purge",
          },
          state: "succeeded",
        }))
      }
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope={scope}
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)

    const confirmation = await screen.findByRole("textbox", { name: "Type RESET ALL MEMORY" })
    fireEvent.change(confirmation, { target: { value: "RESET ALL MEMORY" } })
    fireEvent.click(screen.getByRole("button", { name: "Reset all memory" }))

    expect(await screen.findByText("purge-space-1")).toBeTruthy()
    expect(screen.getByText("Physical purge is still in progress")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Recover outcome" })).toBeTruthy()
    expect(createMemoryCommandJournal({ storage: window.localStorage, scope }).list()).toMatchObject([{ commandId: resetCommandId }])
  })

  test("does not lose a refreshed export when a same-generation settings command settles in the same React batch", async () => {
    const selected = entryValue("entry-1", "Concurrent export memory")
    const queuedExport = {
      artifactDownloadRequest: null,
      expiresAt: null,
      exportRef: "export-1",
      failureCode: null,
      format: "kokoro_memory_export_v1",
      requestedAt: "2026-07-31T00:00:00.000Z",
      state: "queued",
      statusVersion: "1",
      updatedAt: "2026-07-31T00:00:01.000Z",
    }
    const readyExport = {
      ...queuedExport,
      artifactDownloadRequest: {
        artifactRef: "artifact:memory-1",
        artifactVersionRef: "version:memory-1",
        deliveryRequestRef: "delivery:memory-1",
        deliveryUrl: "/api/media/artifacts/artifact%3Amemory-1/versions/version%3Amemory-1/content?purpose=export&exportIntentRef=delivery%3Amemory-1",
        purpose: "export",
      },
      expiresAt: "2026-08-01T00:00:00.000Z",
      state: "ready",
      statusVersion: "2",
      updatedAt: "2026-07-31T00:00:02.000Z",
    }
    let releaseExport!: () => void
    let releaseSettings!: () => void
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { command: { commandId: string } }
        return new Promise<Response>((resolve) => {
          releaseSettings = () => resolve(Response.json({
            command: {
              commandId: body.command.commandId,
              commandKind: "updateMemorySettings",
              receiptRef: "receipt-settings-1",
              receivedAt: "2026-07-31T00:00:00.000Z",
              updatedAt: "2026-07-31T00:00:02.000Z",
            },
            committedSpaceVersion: "1",
            result: {
              resultKind: "settings",
              settings: {
                ...settings,
                revision: "2",
                savedMemoryUse: { ...settings.savedMemoryUse, effective: false, requested: false },
              },
            },
            state: "succeeded",
          }))
        })
      }
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?") && !path.includes("history")) return Promise.resolve(Response.json({
        items: [selected],
        ownerSnapshot: { snapshotRef: "snapshot:export:1", spaceVersion: "1" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.endsWith("/exports") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { command: { commandId: string } }
        return Promise.resolve(Response.json({
          command: {
            commandId: body.command.commandId,
            commandKind: "requestMemoryExport",
            receiptRef: "receipt-export-1",
            receivedAt: "2026-07-31T00:00:00.000Z",
            updatedAt: "2026-07-31T00:00:01.000Z",
          },
          committedSpaceVersion: "1",
          result: { export: queuedExport, resultKind: "export" },
          state: "succeeded",
        }))
      }
      if (path.endsWith("/exports/export-1")) return new Promise<Response>((resolve) => {
        releaseExport = () => resolve(Response.json({ export: readyExport }))
      })
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)
    await screen.findByRole("button", { name: /Concurrent export memory/ })
    fireEvent.click(screen.getByRole("button", { name: "Request export with history" }))
    const refresh = await screen.findByRole("button", { name: "Refresh export" })

    await act(async () => {
      refresh.click()
      screen.getByRole("checkbox", { name: "Request Saved memory" }).click()
      releaseExport()
      await Promise.resolve()
      await Promise.resolve()
      releaseSettings()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(await screen.findByRole("link", { name: "Download authorized export" })).toBeTruthy()
    expect(screen.queryByText("Queued")).toBeNull()
  })

  test("moves focus from the keyboard-native memory control to the loaded detail region", async () => {
    const selected = entryValue("entry-1", "Keyboard focus memory")
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [selected],
        ownerSnapshot: { snapshotRef: "snapshot:keyboard:1", spaceVersion: "1" },
        pageInfo: { hasMore: false, nextCursor: null },
      }))
      if (path.endsWith("/entries/entry-1")) return Promise.resolve(Response.json({ entry: selected, observedSpaceVersion: "1" }))
      if (path.includes("/entries/entry-1/history")) return Promise.resolve(historyResponse("entry-1"))
      throw new Error(`Unexpected Memory request: ${path}`)
    })
    render(<MemoryProduct
      brandName="Site A"
      browserRuntimeScope="site-a:user-1:release-1"
      csrfToken="csrf-stable"
      fetch={fetcher}
    />)

    const memoryButton = await screen.findByRole("button", { name: /Keyboard focus memory/ })
    memoryButton.focus()
    expect(document.activeElement).toBe(memoryButton)
    fireEvent.click(memoryButton)

    const detail = await screen.findByRole("region", { name: "Memory detail" })
    await waitFor(() => expect(document.activeElement).toBe(detail))
  })
})
