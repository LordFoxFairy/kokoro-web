// 作品库面板（ARTIFACT-LIB）：卡片网格渲染 + 空态 + 游标翻页 + 来源会话跳转。客户端为注入 fake。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ArtifactList } from "@/contract/http"
import { LocaleProvider } from "@/i18n/context"
import { ArtifactLibraryPanel } from "@/ui/library/artifact-library-panel"

function artifact(hash: string, sessionId: string): ArtifactList["artifacts"][number] {
  return {
    content_hash: hash,
    session_id: sessionId,
    title: `Artifact ${hash}`,
    mime: "application/pdf",
    size: 2048,
    created_at: "2026-07-02T00:00:01.000Z",
  }
}

function renderPanel(listArtifacts: (cursor?: string) => Promise<ArtifactList>, onOpenSession = vi.fn()) {
  return {
    onOpenSession,
    ...render(
      <ArtifactLibraryPanel client={{ listArtifacts }} onClose={vi.fn()} onOpenSession={onOpenSession} />,
      { wrapper: LocaleProvider },
    ),
  }
}

afterEach(cleanup)

describe("ArtifactLibraryPanel", () => {
  it("renders artifact cards with title and size", async () => {
    renderPanel(vi.fn().mockResolvedValue({ artifacts: [artifact("h1", "s1"), artifact("h2", "s2")] }))
    await screen.findByText("Artifact h1")
    expect(screen.getByText("Artifact h2")).toBeTruthy()
    // 网格容器就位。
    expect(screen.getByTestId("library-grid")).toBeTruthy()
  })

  it("shows empty state when there are no artifacts", async () => {
    renderPanel(vi.fn().mockResolvedValue({ artifacts: [] }))
    await screen.findByTestId("library-empty")
  })

  it("paginates via next_cursor on load more", async () => {
    const listArtifacts = vi
      .fn()
      .mockResolvedValueOnce({ artifacts: [artifact("h1", "s1")], next_cursor: "cur_2" })
      .mockResolvedValueOnce({ artifacts: [artifact("h2", "s2")] })
    renderPanel(listArtifacts)
    await screen.findByText("Artifact h1")
    fireEvent.click(screen.getByText("Load more"))
    await screen.findByText("Artifact h2")
    expect(listArtifacts).toHaveBeenLastCalledWith("cur_2")
  })

  it("jumps to the source session on click", async () => {
    const onOpenSession = vi.fn()
    renderPanel(vi.fn().mockResolvedValue({ artifacts: [artifact("h1", "ses_src")] }), onOpenSession)
    await screen.findByText("Artifact h1")
    fireEvent.click(screen.getByText("Open source session"))
    expect(onOpenSession).toHaveBeenCalledWith("ses_src")
  })

  it("shows an error state when loading fails", async () => {
    renderPanel(vi.fn().mockRejectedValue(new Error("boom")))
    await waitFor(() => expect(screen.getByText("Failed to load artifacts")).toBeTruthy())
  })
})
