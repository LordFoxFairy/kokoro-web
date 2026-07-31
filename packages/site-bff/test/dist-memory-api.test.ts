import { describe, expect, test } from "vitest"

import { createSiteMemoryApi } from "../dist/memory-api.js"

describe("published Site Memory BFF artifact", () => {
  test("fails closed when Platform omits the Memory surface", async () => {
    const origin = "https://site.example"
    const surface = createSiteMemoryApi({
      readAuthSession: () => Object.freeze({}) as never,
      runtime: {
        memory: () => Promise.resolve(null),
        publicOrigin: origin,
        verifyBrowserMutation: () => false,
      } as never,
    })
    const request = new Request(`${origin}/api/memory/settings`, {
      headers: { "sec-fetch-site": "same-origin" },
    })

    const response = await surface.handle(request, ["settings"])

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Memory operation was not found" },
    })
  })
})
