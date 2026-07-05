// 产物 chip 与 canvas 内容体：chip 显示名与大小；PreviewBody 按 MIME 分派（媒体/懒文本/下载兜底）。
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/engine/config", () => ({ sessionBaseUrl: () => "http://s.local" }))

import { ArtifactChip, PreviewBody, artifactUrl } from "@/ui/thread/artifact-card"

const base = { artifact_id: "run_1/t1-a", name: "a", bytes: 8 }

describe("ArtifactChip / PreviewBody", () => {
  it("chip：文件名+大小，点击触发 onOpen（canvas 入口）", () => {
    const onOpen = vi.fn()
    render(<ArtifactChip artifact={{ ...base, name: "a.wav", mime: "audio/wav" }} onOpen={onOpen} />)
    screen.getByText("a.wav").click()
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it("audio/*：原生播放器，src 指向产物端点（分段编码）", () => {
    const artifact = { ...base, name: "a.wav", mime: "audio/wav" }
    const { container } = render(
      <PreviewBody url={artifactUrl("ses_1", artifact)} artifact={artifact} />,
    )
    const audio = container.querySelector("audio")
    expect(audio).not.toBeNull()
    expect(audio!.getAttribute("src")).toBe("http://s.local/sessions/ses_1/artifacts/run_1/t1-a")
  })

  it("未知类型：下载兜底文案", () => {
    const artifact = { ...base, name: "x.bin", mime: "application/x-blob" }
    render(<PreviewBody url="http://s.local/x" artifact={artifact} />)
    expect(screen.getByText(/暂不支持内嵌预览/)).toBeInTheDocument()
  })
})
