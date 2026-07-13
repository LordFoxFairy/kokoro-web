// 会话头部分享控件（SHARE-1）：创建→公共链接可复制→撤销回到初态。客户端为注入 fake。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SessionClient } from "@/engine/client"
import { LocaleProvider } from "@/i18n/context"
import { ShareButton } from "@/ui/share/share-button"

function makeClient(overrides: Partial<Pick<SessionClient, "createShare" | "revokeShare">> = {}) {
  return {
    createShare: vi.fn().mockResolvedValue({ share_id: "shr_abc123" }),
    revokeShare: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  }
}

afterEach(cleanup)

describe("ShareButton", () => {
  it("creates a share and reveals the public link", async () => {
    const client = makeClient()
    render(<ShareButton client={client} sessionId="ses_1" />, { wrapper: LocaleProvider })
    fireEvent.click(screen.getByTestId("share-button"))
    await waitFor(() => {
      const link = screen.getByLabelText("Public share link") as HTMLInputElement
      expect(link.value).toContain("/shared/shr_abc123")
    })
    expect(client.createShare).toHaveBeenCalledWith("ses_1")
  })

  it("copies the link to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    // 只覆盖 clipboard，不整体替换 navigator（否则会抹掉 LocaleProvider 依赖的 navigator.languages）。
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
    render(<ShareButton client={makeClient()} sessionId="ses_1" />, { wrapper: LocaleProvider })
    fireEvent.click(screen.getByTestId("share-button"))
    await screen.findByText("Copy link")
    fireEvent.click(screen.getByText("Copy link"))
    await waitFor(() => expect(screen.getByText("Copied")).toBeTruthy())
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/shared/shr_abc123"))
  })

  it("revokes the share and returns to idle", async () => {
    const client = makeClient()
    render(<ShareButton client={client} sessionId="ses_1" />, { wrapper: LocaleProvider })
    fireEvent.click(screen.getByTestId("share-button"))
    await screen.findByText("Revoke share")
    fireEvent.click(screen.getByText("Revoke share"))
    await waitFor(() => expect(screen.queryByText("Revoke share")).toBeNull())
    expect(client.revokeShare).toHaveBeenCalledWith("ses_1")
    // 回到初态：分享触发按钮仍在。
    expect(screen.getByTestId("share-button")).toBeTruthy()
  })

  it("surfaces an error when creation fails", async () => {
    render(<ShareButton client={makeClient({ createShare: vi.fn().mockRejectedValue(new Error("x")) })} sessionId="ses_1" />, {
      wrapper: LocaleProvider,
    })
    fireEvent.click(screen.getByTestId("share-button"))
    await screen.findByText("Share failed")
  })
})
