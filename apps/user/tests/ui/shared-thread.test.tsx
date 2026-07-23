// 公共只读线程（SHARE-1）：从公共快照复用 ConversationThread 渲染件——用户气泡 + assistant 文本。
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionSnapshot } from "@/contract/http"
import { LocaleProvider } from "@/i18n/context"
import { SharedThread } from "@/ui/shared/shared-thread"

function snapshot(): SessionSnapshot {
  return {
    session: {
      session_id: "ses_1",
      title: "Shared thread",
      owner_id: "alice",
      created_at: "2026-07-02T00:00:00.000Z",
      updated_at: "2026-07-02T00:00:02.000Z",
    },
    messages: [
      { message_id: "m_u", role: "user", content: "hello from user", status: "completed", created_at: "2026-07-02T00:00:01.000Z" },
      { message_id: "m_a", role: "assistant", content: "hi from assistant", status: "completed", run_id: "run_1", created_at: "2026-07-02T00:00:02.000Z" },
    ],
    pending_pauses: [],
    files: [],
    deliveries: [],
    event_watermark: 2,
  }
}

afterEach(cleanup)

describe("SharedThread", () => {
  it("renders user and assistant messages from the public snapshot", () => {
    render(<SharedThread snapshot={snapshot()} />, { wrapper: LocaleProvider })
    expect(screen.getByText("hello from user")).toBeTruthy()
    expect(screen.getByText("hi from assistant")).toBeTruthy()
  })

  it("renders an empty thread without crashing", () => {
    const empty = snapshot()
    empty.messages = []
    render(<SharedThread snapshot={empty} />, { wrapper: LocaleProvider })
    // 无消息也不抛（只读空线程）。
    expect(screen.queryByText("hello from user")).toBeNull()
  })
})
