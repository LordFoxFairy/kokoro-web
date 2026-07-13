import { afterEach, describe, expect, it, vi } from "vitest"

import { createHubClient, HubClientError } from "@/hub/client"

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("hub client", () => {
  it("unwraps { data } and returns the skill pool", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          skills: [{ name: "brainstorming", description: "d", content_hash: "h1", scope: "official" }],
        },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const pool = await createHubClient().listSkillPool()
    expect(pool).toHaveLength(1)
    expect(pool[0]?.name).toBe("brainstorming")
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/hub/self/skills/pool")
  })

  it("surfaces the hub error code on a 409 required-skill disable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "hub.skill_required", message: "required" } }, 409),
      ),
    )
    const client = createHubClient()
    await expect(client.setSkillEnabled("brainstorming", false)).rejects.toMatchObject({
      code: "hub.skill_required",
      status: 409,
    } satisfies Partial<HubClientError>)
  })

  it("posts the zip as multipart with a JSON names field on confirm", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { namespace: "team_1", results: [] } }))
    vi.stubGlobal("fetch", fetchMock)
    await createHubClient().confirmUpload(new Blob(["zip"]), ["a", "b"])
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe("POST")
    const form = init.body as FormData
    expect(form.get("names")).toBe('["a","b"]')
    expect(form.get("file")).toBeInstanceOf(Blob)
  })

  it("fails loud (parse) when the pool payload violates the schema", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ data: { skills: [{ name: "x" }] } })))
    await expect(createHubClient().listSkillPool()).rejects.toBeInstanceOf(HubClientError)
  })
})
