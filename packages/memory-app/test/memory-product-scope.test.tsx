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

function entryResponse(entryRef: string, content: string, overrides: Readonly<Record<string, unknown>> = {}): Response {
  return Response.json({ entry: entryValue(entryRef, content, overrides) })
}

function historyResponse(entryRef: string): Response {
  return Response.json({ entryRef, items: [], pageInfo: { hasMore: false, nextCursor: null } })
}

describe("Memory product runtime scope", () => {
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
        return Promise.resolve(Response.json({ items: [], pageInfo: { hasMore: false, nextCursor: null } }))
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
          return new Promise<Response>((resolve) => releases.push(() => resolve(entryResponse("entry-a", "Stale deep-link A"))))
        }
        return Promise.resolve(entryResponse("entry-a", "Current deep-link A"))
      }
      if (path.includes("/entries/entry-b/history")) return Promise.resolve(historyResponse("entry-b"))
      if (path.endsWith("/entries/entry-b")) return Promise.resolve(entryResponse("entry-b", "Current deep-link B"))
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
            pageInfo: { hasMore: false, nextCursor: null },
          }))
        })
      }
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [entryValue("entry-1", "Current memory")],
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

  test("does not let old selected detail or history settle after reset commits", async () => {
    const releases: Array<() => void> = []
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({
        items: [entryValue("entry-1", "Current memory")],
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
          pageInfo: { hasMore: false, nextCursor: null },
        }))))
      }
      if (path.endsWith("/entries/entry-1")) {
        return new Promise<Response>((resolve) => releases.push(() => resolve(entryResponse("entry-1", "Stale selected content"))))
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
        return Promise.resolve(Response.json({ items: [], pageInfo: { hasMore: false, nextCursor: null } }))
      }
      if (path.includes("/entries?")) {
        listCalls += 1
        return Promise.resolve(Response.json({
          items: [stale],
          pageInfo: { hasMore: true, nextCursor: listCalls === 1 ? "cursor-before-priority" : "cursor-from-stale-page" },
        }))
      }
      if (path.endsWith("/entries/entry-1")) return Promise.resolve(Response.json({ entry: stale }))
      if (path.includes("/entries/entry-1/history")) return Promise.resolve(historyResponse("entry-1"))
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
    fireEvent.click(screen.getByRole("button", { name: "Load more memories" }))
    await waitFor(() => expect(listCalls).toBe(3))
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("cursor=cursor-before-priority"))).toBe(true)
    expect(fetcher.mock.calls.some(([input]) => String(input).includes("cursor=cursor-from-stale-page"))).toBe(false)
  })

  test("shows the reset purge receipt and keeps exact recovery while physical purge is pending", async () => {
    let resetCommandId = ""
    const scope = "site-a:user-1:release-1"
    const fetcher = vi.fn<MemoryBrowserFetch>((input, init) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({ items: [], pageInfo: { hasMore: false, nextCursor: null } }))
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

  test("moves focus from the keyboard-native memory control to the loaded detail region", async () => {
    const selected = entryValue("entry-1", "Keyboard focus memory")
    const fetcher = vi.fn<MemoryBrowserFetch>((input) => {
      const path = String(input)
      if (path.endsWith("/settings")) return Promise.resolve(Response.json(settings))
      if (path.includes("/entries?")) return Promise.resolve(Response.json({ items: [selected], pageInfo: { hasMore: false, nextCursor: null } }))
      if (path.endsWith("/entries/entry-1")) return Promise.resolve(Response.json({ entry: selected }))
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
