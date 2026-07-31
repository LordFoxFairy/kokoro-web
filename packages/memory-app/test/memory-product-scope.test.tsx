// @vitest-environment happy-dom

import type { MemoryBrowserFetch } from "../src/memory-controller"
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
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
})
