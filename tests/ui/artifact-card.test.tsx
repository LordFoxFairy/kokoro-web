// 文件 chip 与 canvas 内容体：chip=路径即入口；PreviewBody 按 MIME 分派（媒体/懒文本/下载兜底）。
import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/engine/config", () => ({ sessionBaseUrl: () => "http://s.local" }))

import { LocaleProvider } from "@/i18n/context"
import { FileChip, PreviewBody } from "@/ui/thread/artifact-card"
import { fileUrl } from "@/ui/canvas/canvas-panel"

describe("FileChip / PreviewBody / fileUrl", () => {
  beforeEach(() => {
    window.localStorage.setItem("kokoro.locale", "zh")
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

  it("audio/*：原生播放器", () => {
    const { container } = render(
      <PreviewBody url="http://s.local/f.wav" mime="audio/wav" name="f.wav" />,
      { wrapper: LocaleProvider },
    )
    expect(container.querySelector("audio")).not.toBeNull()
  })

  it("未知类型：下载兜底文案", () => {
    render(<PreviewBody url="http://s.local/x" mime="application/octet-stream" name="x.bin" />, { wrapper: LocaleProvider })
    expect(screen.getByText(/暂不支持内嵌预览/)).toBeInTheDocument()
  })
})
