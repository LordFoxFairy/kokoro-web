// 产物卡三态：媒体默认展开播放器 / 文本懒加载（点开才拉） / 未知类型下载卡。
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/engine/config", () => ({ sessionBaseUrl: () => "http://s.local" }))

import { ArtifactCard } from "@/ui/thread/artifact-card"

const base = { artifact_id: "run_1/t1-a", name: "a", bytes: 8 }

describe("ArtifactCard", () => {
  it("audio/*：默认展开原生播放器，src 指向产物端点（分段编码）", () => {
    const { container } = render(
      <ArtifactCard sessionId="ses_1" artifact={{ ...base, name: "a.wav", mime: "audio/wav" }} />,
    )
    const audio = container.querySelector("audio")
    expect(audio).not.toBeNull()
    expect(audio!.getAttribute("src")).toBe("http://s.local/sessions/ses_1/artifacts/run_1/t1-a")
    expect(screen.getByText("下载")).toBeInTheDocument()
  })

  it("text/markdown：懒加载——默认只有预览按钮，不发请求", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    render(<ArtifactCard sessionId="ses_1" artifact={{ ...base, name: "n.md", mime: "text/markdown" }} />)
    expect(screen.getByText("预览")).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("未知类型：下载兜底文案", () => {
    render(<ArtifactCard sessionId="ses_1" artifact={{ ...base, name: "x.bin", mime: "application/x-blob" }} />)
    expect(screen.getByText(/暂不支持内嵌预览/)).toBeInTheDocument()
  })
})
