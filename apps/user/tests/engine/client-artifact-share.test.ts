// SessionClient 作品库/分享端点（ARTIFACT-LIB + SHARE-1）：路径拼接、契约 Zod、游标查询串。
import { afterEach, describe, expect, it, vi } from "vitest"

import { createSessionClient } from "@/engine/client"

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

describe("listArtifacts（ARTIFACT-LIB）：GET /artifacts 过契约 Zod + 游标查询", () => {
  it("首页无 cursor：命中 /api/session/artifacts，返回契约形状", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        artifacts: [
          { content_hash: "h1", session_id: "s1", title: "Report", mime: "application/pdf", size: 12, created_at: "2026-07-02T00:00:01.000Z" },
        ],
        next_cursor: "cur_2",
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const list = await createSessionClient({ baseUrl: "/api/session" }).listArtifacts()
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/artifacts")
    expect(list.artifacts.map((a) => a.content_hash)).toEqual(["h1"])
    expect(list.next_cursor).toBe("cur_2")
  })

  it("带 cursor：编码进查询串", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ artifacts: [] }))
    vi.stubGlobal("fetch", fetchMock)
    await createSessionClient({ baseUrl: "/api/session" }).listArtifacts("cur/x")
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/artifacts?cursor=cur%2Fx")
  })

  it("HTTP 错误 fail-loud（不静默降级）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })))
    await expect(createSessionClient({ baseUrl: "/api/session" }).listArtifacts()).rejects.toThrow()
  })
})

describe("createShare / revokeShare（SHARE-1）：POST|DELETE /sessions/{id}/share", () => {
  it("createShare：POST 命中 share 路径，返回 share_id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ share_id: "shr_abc" }))
    vi.stubGlobal("fetch", fetchMock)
    const receipt = await createSessionClient({ baseUrl: "/api/session" }).createShare("ses_1")
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/sessions/ses_1/share")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" })
    expect(receipt.share_id).toBe("shr_abc")
  })

  it("revokeShare：DELETE 命中 share 路径，返回 {ok:true}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchMock)
    const receipt = await createSessionClient({ baseUrl: "/api/session" }).revokeShare("ses_1")
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/sessions/ses_1/share")
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE" })
    expect(receipt.ok).toBe(true)
  })

  it("createShare 契约拒绝空 share_id（fail-loud）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ share_id: "" })))
    await expect(createSessionClient({ baseUrl: "/api/session" }).createShare("ses_1")).rejects.toThrow()
  })
})
