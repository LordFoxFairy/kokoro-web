import { afterEach, describe, expect, it, vi } from "vitest"

import { createSessionClient, createSseFrameParser } from "@/engine/client"

function collect(chunks: string[]): string[] {
  const frames: string[] = []
  const feed = createSseFrameParser((data) => frames.push(data))
  for (const chunk of chunks) {
    feed(chunk)
  }
  return frames
}

describe("createSseFrameParser：跨 chunk 的 SSE 帧增量解析", () => {
  it("单 chunk 完整帧：取 data 行（忽略 id/event 行）", () => {
    expect(collect(['id: 3\nevent: message.delta\ndata: {"a":1}\n\n'])).toEqual(['{"a":1}'])
  })

  it("帧被任意切开也能拼回（含跨 chunk 的分隔空行）", () => {
    expect(
      collect(["id: 3\nevent: x\nda", 'ta: {"a"', ":1}\n", "\nid: 4\ndata: {}\n\n"]),
    ).toEqual(['{"a":1}', "{}"])
  })

  it("多 data 行按 SSE 语义以换行拼接", () => {
    expect(collect(["data: line1\ndata: line2\n\n"])).toEqual(["line1\nline2"])
  })

  it.each([
    ["空帧（心跳注释）", [":keep-alive\n\n"]],
    ["无 data 行的帧", ["id: 1\nevent: ping\n\n"]],
    ["空输入", [""]],
  ])("%s 不产出回调", (_label, chunks) => {
    expect(collect(chunks)).toEqual([])
  })

  it("CRLF 行尾同样解析", () => {
    expect(collect(["data: {}\r\n\ndata: ok\n\n"])).toEqual(["{}", "ok"])
  })

  it("未闭合的尾帧保持缓冲，不提前吐出", () => {
    const frames: string[] = []
    const feed = createSseFrameParser((data) => frames.push(data))
    feed("data: pending")
    expect(frames).toEqual([])
    feed("\n\n")
    expect(frames).toEqual(["pending"])
  })
})

describe("fetchSnapshot：会话不存在/已软删都优雅缺席（不 fail-loud）", () => {
  afterEach(() => vi.unstubAllGlobals())

  const clientFor = (status: number) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })))
    return createSessionClient({ baseUrl: "http://session.test/" })
  }

  it("404（从无此会话）→ null，空线程即真态", async () => {
    await expect(clientFor(404).fetchSnapshot("conv_x")).resolves.toBeNull()
  })

  it("410 Gone（软删会话）→ null，水合优雅缺席而非硬错屏", async () => {
    await expect(clientFor(410).fetchSnapshot("conv_x")).resolves.toBeNull()
  })

  it("其它非 ok（500）仍 fail-loud 抛错", async () => {
    await expect(clientFor(500).fetchSnapshot("conv_x")).rejects.toThrow()
  })
})

describe("listModels（MODEL-UX）：GET /models 过契约 Zod", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("解析候选列表（provider/name/is_default）+ 命中 /models 路径", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ models: [{ provider: "anthropic", name: "claude-sonnet-4-6", is_default: true }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)
    const list = await createSessionClient({ baseUrl: "/api/session" }).listModels()
    expect(list.models).toEqual([{ provider: "anthropic", name: "claude-sonnet-4-6", is_default: true }])
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/models")
  })

  it("非 ok 时 fail-loud 抛错（不静默降级）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })))
    await expect(createSessionClient({ baseUrl: "/api/session" }).listModels()).rejects.toThrow()
  })
})

describe("renameSession（CONV-UX）：PATCH /sessions/{id}/title 过契约 Zod", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("PATCH 命中 /title 路径 + 送 {title} 体 + 解析 {ok:true}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const receipt = await createSessionClient({ baseUrl: "/api/session" }).renameSession("ses_1", "新标题")
    expect(receipt).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/session/sessions/ses_1/title")
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe("PATCH")
    expect(JSON.parse(init.body as string)).toEqual({ title: "新标题" })
  })

  it("非 ok（422 超长 / 403 他人 / 404 软删）fail-loud 抛错（错误码回带）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "title_too_long" }), {
          status: 422,
          headers: { "content-type": "application/json" },
        }),
      ),
    )
    await expect(
      createSessionClient({ baseUrl: "/api/session" }).renameSession("ses_1", "x"),
    ).rejects.toThrow("title_too_long")
  })
})
