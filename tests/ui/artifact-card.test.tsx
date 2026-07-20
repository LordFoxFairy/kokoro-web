// 文件 chip 与 canvas 内容体：chip=路径即入口；PreviewBody 按 MIME 分派（媒体/懒文本/下载兜底）。
import { render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/engine/config", () => ({ sessionBaseUrl: () => "http://s.local" }))

import { LocaleProvider } from "@/i18n/context"
import { FileChip, PreviewBody } from "@/ui/thread/artifact-card"
import { fileUrl } from "@/ui/canvas/canvas-panel"

describe("FileChip / PreviewBody / fileUrl", () => {
  beforeEach(() => {
    window.localStorage.setItem("kokoro.locale", "zh")
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.removeItem("kokoro.auth.token")
  })

  it("chip：显示文件名，点击触发 onOpen（canvas 入口）", () => {
    const onOpen = vi.fn()
    render(<FileChip path="media/track.wav" onOpen={onOpen} />, { wrapper: LocaleProvider })
    screen.getByText("track.wav").click()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("fileUrl：files 端点 + 逐段编码", () => {
    expect(fileUrl("ses_1", "media/我的 文件.wav")).toBe(
      "http://s.local/sessions/ses_1/files/media/%E6%88%91%E7%9A%84%20%E6%96%87%E4%BB%B6.wav",
    )
  })

  it("audio/*：同源鉴权拉取字节 → blob src 原生播放器（cookie 自动携带，前端不持 token）", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: async () => new Blob(["x"], { type: "audio/wav" }) })
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock")
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    const { container } = render(
      <PreviewBody url="http://s.local/f.wav" mime="audio/wav" name="f.wav" />,
      { wrapper: LocaleProvider },
    )
    await waitFor(() => expect(container.querySelector("audio")).not.toBeNull())
    // src 必须是 blob（不是端点直连）：<audio src> 带不了自定义头，故一律 fetch→blob→object URL。
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:mock")
    const [reqUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(reqUrl).toBe("http://s.local/f.wav")
    // 冻结当前鉴权形态（AUTH-P0）：同源 httpOnly 信封 cookie 自动携带 —— 前端不再持 token、
    // 不再手挂 Authorization 头。若哪天又出现 Bearer 头，即是把 token 漏回前端的回归。
    expect(init.headers).toBeUndefined()
    expect(init.cache).toBe("no-store")
  })

  it("未知类型：下载兜底文案", () => {
    render(<PreviewBody url="http://s.local/x" mime="application/octet-stream" name="x.bin" />, { wrapper: LocaleProvider })
    expect(screen.getByText(/暂不支持内嵌预览/)).toBeInTheDocument()
  })
})
