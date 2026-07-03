import { describe, expect, it } from "vitest"

import { createSseFrameParser } from "@/engine/client"

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
