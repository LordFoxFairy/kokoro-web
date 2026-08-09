// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AccountProduct } from "../src/index.js"

const dashboard = Object.freeze({
  features: { security: false, redemption: true, products: false, credits: true },
  availability: { security: "disabled", products: "disabled", credits: "available" },
  sessions: [],
  products: [],
  credits: [{ unit: "credits", buckets: [{ bucketClass: "permanent", available: "10", held: "0", consumed: "0", expiredOrReversed: "0" }] }],
  freshness: { products: "available", credits: "available" },
})

const preview = Object.freeze({
  state: "ready",
  product: "Starter credits",
  plan: null,
  kind: "credit_pack",
  expiresAt: "2026-08-09T13:00:00.000Z",
  term: { action: "none", automaticRenewal: false, startsAt: null, endsAt: null },
  entitlements: [],
  credits: [{ amount: "10", unit: "credits", bucketClass: "permanent", expiresAt: null }],
  legalAcceptanceRequired: false,
  legalDocuments: [],
})

type Call = Readonly<{ action: string; body: Record<string, unknown> | null }>

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: body === null ? undefined : { "content-type": "application/json" },
  })
}

function requestBody(init?: RequestInit): Record<string, unknown> | null {
  return typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null
}

async function previewCode() {
  await screen.findByText("Redeem a code")
  fireEvent.change(screen.getByLabelText("Code"), { target: { value: "RAW-CODE-123456789" } })
  fireEvent.click(screen.getByRole("button", { name: "Preview" }))
  await screen.findByText("Starter credits")
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("Account redemption confirmation", () => {
  it("polls the existing recover route with one flowRef and refreshes only after succeeded", async () => {
    const calls: Call[] = []
    const recovered = [
      { state: "executing", retryAfter: "2026-08-09T00:00:00.000Z" },
      { state: "outcome_unknown", retryAfter: "2026-08-09T00:00:00.000Z" },
      { state: "succeeded", productState: "fulfilled", redeemedAt: "2026-08-09T00:00:00.000Z" },
    ]
    let dashboardReads = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const action = url.split("/").at(-1) ?? ""
      const body = requestBody(init)
      calls.push({ action, body })
      if (action === "dashboard") { dashboardReads += 1; return response(dashboard) }
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      if (action === "execute") return response({ state: "accepted", retryAfter: "2026-08-09T00:00:00.000Z" })
      return response(recovered.shift())
    }))

    render(<AccountProduct brandName="Kokoro" csrfToken="csrf-token-12345678" />)
    await previewCode()
    const readsBeforeConfirmation = dashboardReads
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }))

    await screen.findByText("Code redeemed. Your account has been refreshed.")
    expect(screen.queryByText("Starter credits")).toBeNull()
    expect(dashboardReads).toBe(readsBeforeConfirmation + 1)
    const confirmations = calls.filter(({ body }) => body?.operation === "redemption.confirm")
    expect(confirmations.map(({ action }) => action)).toEqual(["prepare", "execute", "recover", "recover", "recover"])
    const flowRefs = confirmations.map(({ body }) => body?.flowRef)
    expect(new Set(flowRefs).size).toBe(1)
  })

  it("retains the confirmation flow after a network interruption and resumes from the button", async () => {
    const confirmationCalls: Call[] = []
    let dashboardReads = 0
    let recoveryFailures = 1
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const action = url.split("/").at(-1) ?? ""
      const body = requestBody(init)
      if (action === "dashboard") { dashboardReads += 1; return response(dashboard) }
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      confirmationCalls.push({ action, body })
      if (action === "execute") throw new TypeError("network disconnected")
      if (recoveryFailures-- > 0) throw new TypeError("network disconnected")
      return response({ state: "succeeded", productState: "fulfilled", redeemedAt: "2026-08-09T00:00:00.000Z" })
    }))

    render(<AccountProduct brandName="Kokoro" csrfToken="csrf-token-12345678" />)
    await previewCode()
    const readsBeforeConfirmation = dashboardReads
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }))

    const continueButton = await screen.findByRole("button", { name: "Continue confirmation result" })
    expect(screen.getByText("Starter credits")).toBeTruthy()
    expect(dashboardReads).toBe(readsBeforeConfirmation)
    fireEvent.click(continueButton)

    await screen.findByText("Code redeemed. Your account has been refreshed.")
    expect(dashboardReads).toBe(readsBeforeConfirmation + 1)
    const flowRefs = confirmationCalls.map(({ body }) => body?.flowRef)
    expect(flowRefs.length).toBe(3)
    expect(new Set(flowRefs).size).toBe(1)
  })

  it.each([
    [{ state: "rejected", retry: "never" }, "This code redemption was rejected."],
    [{ state: "review_required", expiresAt: "2026-08-10T00:00:00.000Z" }, "This code redemption requires review. No further confirmation is needed."],
    [{ state: "succeeded", productState: "reversed", redeemedAt: "2026-08-09T00:00:00.000Z" }, "This redemption was reversed and did not add account benefits."],
    [{ state: "succeeded", productState: "reconciliation_required", redeemedAt: "2026-08-09T00:00:00.000Z" }, "This redemption needs reconciliation before account benefits can be confirmed."],
  ])("renders %s as terminal without clearing the preview or refreshing balances", async (terminal, message) => {
    let dashboardReads = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split("/").at(-1) ?? ""
      const body = requestBody(init)
      if (action === "dashboard") { dashboardReads += 1; return response(dashboard) }
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      return response(terminal)
    }))

    render(<AccountProduct brandName="Kokoro" csrfToken="csrf-token-12345678" />)
    await previewCode()
    const readsBeforeConfirmation = dashboardReads
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }))

    await screen.findByText(message)
    expect(screen.getByText("Starter credits")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Continue confirmation result" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Confirm redemption" })).toBeNull()
    expect(dashboardReads).toBe(readsBeforeConfirmation)
  })

  it("turns a never-settling confirmation request into same-flow continuation at the overall deadline", async () => {
    const calls: Call[] = []
    const stalled: { signal?: AbortSignal } = {}
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split("/").at(-1) ?? ""
      const body = requestBody(init)
      calls.push({ action, body })
      if (action === "dashboard") return response(dashboard)
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      if (action === "execute") {
        if (init?.signal) stalled.signal = init.signal
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal
          if (signal?.aborted) reject(new Error("request_aborted"))
          else signal?.addEventListener("abort", () => reject(new Error("request_aborted")), { once: true })
        })
      }
      return response({ state: "succeeded", productState: "fulfilled", redeemedAt: "2026-08-09T00:00:00.000Z" })
    }))

    render(<AccountProduct brandName="Kokoro" csrfToken="csrf-token-12345678" />)
    await previewCode()
    vi.useFakeTimers()
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }))

    await act(async () => { await vi.advanceTimersByTimeAsync(30_001) })

    const continueButton = screen.getByRole("button", { name: "Continue confirmation result" })
    expect(stalled.signal?.aborted).toBe(true)
    fireEvent.click(continueButton)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(screen.getByText("Code redeemed. Your account has been refreshed.")).toBeTruthy()
    const confirmationCalls = calls.filter(({ body }) => body?.operation === "redemption.confirm")
    expect(new Set(confirmationCalls.map(({ body }) => body?.flowRef)).size).toBe(1)
  })

  it("does not refresh or write a terminal result after unmount", async () => {
    const recovered = deferred<unknown>()
    let dashboardReads = 0
    let recoveryReads = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split("/").at(-1) ?? ""
      const body = requestBody(init)
      if (action === "dashboard") { dashboardReads += 1; return response(dashboard) }
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      if (action === "execute") return response({ state: "accepted", retryAfter: "2026-08-09T00:00:00.000Z" })
      recoveryReads += 1
      return response(await recovered.promise)
    }))

    const view = render(<AccountProduct brandName="Kokoro" csrfToken="csrf-token-12345678" />)
    await previewCode()
    const readsBeforeConfirmation = dashboardReads
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }))
    await waitFor(() => expect(recoveryReads).toBe(1))

    view.unmount()
    await act(async () => {
      recovered.resolve({ state: "succeeded", productState: "fulfilled", redeemedAt: "2026-08-09T00:00:00.000Z" })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(dashboardReads).toBe(readsBeforeConfirmation)
  })

  it("cancels an old authority flow and discards its late terminal result", async () => {
    const recovered = deferred<unknown>()
    const dashboardReads = new Map<string, number>()
    let recoveryReads = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const action = url.split("/").at(-1) ?? ""
      const body = requestBody(init)
      const authority = url.includes("site-b") ? "site-b" : "site-a"
      if (action === "dashboard") {
        dashboardReads.set(authority, (dashboardReads.get(authority) ?? 0) + 1)
        return response(dashboard)
      }
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      if (action === "execute") return response({ state: "accepted", retryAfter: "2026-08-09T00:00:00.000Z" })
      recoveryReads += 1
      return response(await recovered.promise)
    }))

    const view = render(<AccountProduct apiPrefix="/api/site-a/account" brandName="Kokoro" csrfToken="csrf-site-a-12345678" />)
    await previewCode()
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }))
    await waitFor(() => expect(recoveryReads).toBe(1))

    view.rerender(<AccountProduct apiPrefix="/api/site-b/account" brandName="Kokoro" csrfToken="csrf-site-b-12345678" />)
    await waitFor(() => expect(screen.queryByText("Starter credits")).toBeNull())
    await waitFor(() => expect(dashboardReads.get("site-b")).toBe(1))
    const siteAReads = dashboardReads.get("site-a")

    await act(async () => {
      recovered.resolve({ state: "succeeded", productState: "fulfilled", redeemedAt: "2026-08-09T00:00:00.000Z" })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(dashboardReads.get("site-a")).toBe(siteAReads)
    expect(screen.queryByText("Code redeemed. Your account has been refreshed.")).toBeNull()
  })

  it("submits only one confirmation flow for repeated clicks", async () => {
    const confirmation = deferred<Response>()
    const calls: Call[] = []
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split("/").at(-1) ?? ""
      const body = requestBody(init)
      calls.push({ action, body })
      if (action === "dashboard") return response(dashboard)
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      return confirmation.promise
    }))

    render(<AccountProduct brandName="Kokoro" csrfToken="csrf-token-12345678" />)
    await previewCode()
    const button = screen.getByRole("button", { name: "Confirm redemption" })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(calls.filter(({ body }) => body?.operation === "redemption.confirm").length).toBeGreaterThan(0))

    const confirmationCalls = calls.filter(({ body }) => body?.operation === "redemption.confirm")
    expect(confirmationCalls.filter(({ action }) => action === "prepare")).toHaveLength(1)
    expect(confirmationCalls.filter(({ action }) => action === "execute")).toHaveLength(1)
  })

  it("keeps the same flow recoverable after an invalid recovery response", async () => {
    const calls: Call[] = []
    let dashboardReads = 0
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const action = String(input).split("/").at(-1) ?? ""
      const body = requestBody(init)
      calls.push({ action, body })
      if (action === "dashboard") { dashboardReads += 1; return response(dashboard) }
      if (action === "prepare") return response(null, 204)
      if (body?.operation === "redemption.preview") return response(preview)
      if (action === "execute") return response({ state: "accepted", retryAfter: "2026-08-09T00:00:00.000Z" })
      return response({ state: "succeeded", productState: "fulfilled", redeemedAt: "2026-08-09T00:00:00.000Z", unexpected: true })
    }))

    render(<AccountProduct brandName="Kokoro" csrfToken="csrf-token-12345678" />)
    await previewCode()
    const readsBeforeConfirmation = dashboardReads
    fireEvent.click(screen.getByRole("button", { name: "Confirm redemption" }))

    await screen.findByRole("button", { name: "Continue confirmation result" })
    expect(screen.getByText("Starter credits")).toBeTruthy()
    expect(dashboardReads).toBe(readsBeforeConfirmation)
    const confirmationCalls = calls.filter(({ body }) => body?.operation === "redemption.confirm")
    expect(new Set(confirmationCalls.map(({ body }) => body?.flowRef)).size).toBe(1)
  })
})
