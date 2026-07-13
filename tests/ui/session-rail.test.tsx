// 侧栏会话重命名内联编辑（CONV-UX）：双击/✎ 进入编辑，Enter 提交、Escape 取消、空题与未改动不上抛。

import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { LocaleProvider } from "@/i18n/context"
import { SessionRail } from "@/ui/rail/session-rail"
import type { ConversationSummary } from "@/ui/rail/rail-search"

function renderRail(overrides?: Partial<Parameters<typeof SessionRail>[0]>) {
  const onRenameConversation = vi.fn()
  const conversations: ConversationSummary[] = [{ id: "ses_1", title: "旧标题" }]
  render(
    <LocaleProvider>
      <SessionRail
        collapsed={false}
        onToggleCollapse={() => {}}
        onNewChat={() => {}}
        conversations={conversations}
        activeId="ses_1"
        onSelectConversation={() => {}}
        onDeleteConversation={() => {}}
        onRenameConversation={onRenameConversation}
        onOpenSkills={() => {}}
        onOpenMcp={() => {}}
        onOpenBilling={() => {}}
        onOpenTeams={() => {}}
        onOpenLibrary={() => {}}
        listLoading={false}
        listError={false}
        hasMore={false}
        onLoadMore={() => {}}
        {...overrides}
      />
    </LocaleProvider>,
  )
  return { onRenameConversation }
}

beforeEach(() => {
  window.localStorage.clear()
  window.localStorage.setItem("kokoro.locale", "zh")
})

afterEach(cleanup)

it("双击标题进入编辑，Enter 提交新题一次", () => {
  const { onRenameConversation } = renderRail()
  fireEvent.doubleClick(screen.getByText("旧标题"))
  const input = screen.getByLabelText("会话标题")
  fireEvent.change(input, { target: { value: "全新标题" } })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(onRenameConversation).toHaveBeenCalledTimes(1)
  expect(onRenameConversation).toHaveBeenCalledWith("ses_1", "全新标题")
})

it("✎ 按钮进入编辑，失焦提交", () => {
  const { onRenameConversation } = renderRail()
  fireEvent.click(screen.getByLabelText("重命名会话 旧标题"))
  const input = screen.getByLabelText("会话标题")
  fireEvent.change(input, { target: { value: "改一下" } })
  fireEvent.blur(input)
  expect(onRenameConversation).toHaveBeenCalledWith("ses_1", "改一下")
})

it("Escape 取消不上抛，标题回落原值", () => {
  const { onRenameConversation } = renderRail()
  fireEvent.doubleClick(screen.getByText("旧标题"))
  const input = screen.getByLabelText("会话标题")
  fireEvent.change(input, { target: { value: "不要保存" } })
  fireEvent.keyDown(input, { key: "Escape" })
  expect(onRenameConversation).not.toHaveBeenCalled()
  expect(screen.getByText("旧标题")).toBeInTheDocument()
})

it("空题与未改动不触发请求", () => {
  const { onRenameConversation } = renderRail()
  fireEvent.doubleClick(screen.getByText("旧标题"))
  const input = screen.getByLabelText("会话标题")
  // 空白
  fireEvent.change(input, { target: { value: "   " } })
  fireEvent.keyDown(input, { key: "Enter" })
  expect(onRenameConversation).not.toHaveBeenCalled()
  // 未改动（与原题相同）
  fireEvent.doubleClick(screen.getByText("旧标题"))
  const input2 = screen.getByLabelText("会话标题")
  fireEvent.keyDown(input2, { key: "Enter" })
  expect(onRenameConversation).not.toHaveBeenCalled()
})
