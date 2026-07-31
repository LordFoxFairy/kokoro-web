import { describe, expect, test, vi } from "vitest"

import {
  createMediaBrowserClient,
  createMediaCommandIdentity,
  createMediaCommandRecoveryStore,
} from "../src/browser-client"

describe("Site media browser client", () => {
  test("calls only the exact same-origin media BFF paths and sends browser CSRF on controls", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const fetch = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return Promise.resolve(new Response(JSON.stringify({ items: [], pageInfo: { nextCursor: null } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }))
    })
    const client = createMediaBrowserClient({ fetch, csrfToken: "browser-csrf" })
    await client.listDefinitions({ limit: 20 })
    await client.listOperations({})

    expect(calls.map(({ url }) => url)).toEqual([
      "/api/media/definitions?limit=20",
      "/api/media/operations",
    ])

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ receipt: { receiptKind: "submit_rejected" }, operation: null }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }))
    await client.submit({
      kind: "image_text_to_image",
      definitionRevisionRef: "image.text_to_image@1",
      promptIntent: "A fox beneath the moon",
      aspectRatio: "square_1_1",
      candidateCount: 1,
      modelOptionRevisionRef: "image.safe@1",
      outputFormat: "png",
    }, { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) })

    expect(fetch.mock.calls[2]).toEqual([
      "/api/media/operations",
      expect.objectContaining({ method: "POST", headers: expect.objectContaining({ "x-kokoro-browser-csrf": "browser-csrf" }) }),
    ])
    expect((fetch.mock.calls[2]?.[1] as RequestInit | undefined)?.body).not.toContain("projectRef")

    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ operation: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))
    const controller = new AbortController()
    await client.getOperation("operation-1", controller.signal)
    expect(fetch.mock.calls[3]).toEqual([
      "/api/media/operations/operation-1",
      expect.objectContaining({ method: "GET", signal: controller.signal }),
    ])
  })

  test("persists only command identity for owner recovery", () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    const store = createMediaCommandRecoveryStore({ storage, scope: "site:user:project" })
    const command = { commandId: "1".repeat(32), idempotencyKey: "i".repeat(24) }
    store.remember({ kind: "submit", command, createdAt: "2026-07-31T00:00:00.000Z" })

    expect(store.list()).toEqual([{ kind: "submit", command, createdAt: "2026-07-31T00:00:00.000Z" }])
    expect([...values.values()][0]).not.toMatch(/operation|artifact|ownerVersion/u)
    store.forget(command.commandId)
    expect(store.list()).toEqual([])
  })

  test("creates independent lowercase command and idempotency identities", () => {
    let fill = 0
    const command = createMediaCommandIdentity((length) => new Uint8Array(length).fill(++fill))
    expect(command.commandId).toMatch(/^[0-9a-f]{32}$/u)
    expect(command.idempotencyKey).toMatch(/^[0-9a-f]{48}$/u)
    expect(command.commandId).not.toBe(command.idempotencyKey)
  })
})
