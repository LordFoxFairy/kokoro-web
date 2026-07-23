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

  it("unwraps { servers } from the MCP server pool", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          servers: [
            {
              scope: "team_1",
              name: "my-tools",
              revision: 1,
              transport: "streamable_http",
              url: "https://own.example.com/mcp",
              allowed_tools: [],
              secret_ref: null,
              enabled: true,
            },
          ],
        },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const servers = await createHubClient().listMcpServers()
    expect(servers).toHaveLength(1)
    expect(servers[0]?.name).toBe("my-tools")
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/hub/self/mcp/servers")
  })

  it("posts the register body as JSON and returns the created server", async () => {
    const server = {
      scope: "team_1",
      name: "svc",
      revision: 1,
      transport: "http" as const,
      url: "https://svc.example.com/mcp",
      allowed_tools: ["search"],
      secret_ref: "handle:srt_00000000000000000000000000000001",
      enabled: true,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { server } }, 201))
    vi.stubGlobal("fetch", fetchMock)
    const created = await createHubClient().registerMcpServer({
      name: "svc",
      transport: "http",
      url: "https://svc.example.com/mcp",
      allowed_tools: ["search"],
      secret_ref: "handle:srt_00000000000000000000000000000001",
    })
    expect(created.name).toBe("svc")
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/api/hub/self/mcp/servers")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toMatchObject({
      name: "svc",
      transport: "http",
      secret_ref: "handle:srt_00000000000000000000000000000001",
    })
  })

  it("omits secret_ref from the register body when none is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          data: {
            server: {
              scope: "team_1",
              name: "svc",
              revision: 1,
              transport: "http",
              url: "https://svc.example.com/mcp",
              allowed_tools: [],
              secret_ref: null,
              enabled: true,
            },
          },
        },
        201,
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    await createHubClient().registerMcpServer({
      name: "svc",
      transport: "http",
      url: "https://svc.example.com/mcp",
      allowed_tools: [],
      secret_ref: null,
    })
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(Object.keys(JSON.parse(init.body as string))).not.toContain("secret_ref")
  })

  it("surfaces the hub error code when the mutation gate is closed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "capability_registration_disabled", message: "off" } }, 503),
      ),
    )
    await expect(
      createHubClient().registerMcpServer({
        name: "svc",
        transport: "http",
        url: "https://svc.example.com/mcp",
        allowed_tools: [],
        secret_ref: null,
      }),
    ).rejects.toMatchObject({ code: "capability_registration_disabled", status: 503 })
  })

  it("creates a secret and returns only the handle (value never echoed)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ data: { handle: "srt_00000000000000000000000000000001" } }, 201))
    vi.stubGlobal("fetch", fetchMock)
    const handle = await createHubClient().createMcpSecret("search-key", "super-secret")
    expect(handle).toBe("srt_00000000000000000000000000000001")
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/api/hub/self/mcp/secrets")
    expect(JSON.parse(init.body as string)).toEqual({ name: "search-key", value: "super-secret" })
  })

  it("deletes an MCP server via DELETE without a body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: { ok: true } }))
    vi.stubGlobal("fetch", fetchMock)
    await createHubClient().deleteMcpServer("my-tools")
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(path).toBe("/api/hub/self/mcp/servers/my-tools")
    expect(init.method).toBe("DELETE")
  })
})
