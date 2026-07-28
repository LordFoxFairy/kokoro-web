// ERROR-UX（Wave5）：run.failed 分类文案 + 恢复引导 + message 原文折叠。
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createRef, type ComponentType } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { createSessionStreamState, type RunErrorCode, type SessionStreamState } from "@/core/state"
import { LocaleProvider } from "@/i18n/context"
import { zh, type MessageKey } from "@/i18n/messages"
import { negotiateLocale, resolveMessage } from "@/i18n/resolve"
import { ConversationThread, failureCopyKey } from "@/ui/thread/conversation-thread"

const LegacyConversationThread = ConversationThread as ComponentType<
  React.ComponentProps<typeof ConversationThread> & { onOpenPricing?: () => void }
>

// LocaleProvider 水合后按 navigator.languages 协商语言（jsdom 通常 en）——按同一协商取译文断言，
// 不写死语言，避免测试与运行环境语言绑定。
const LOCALE = negotiateLocale(null, typeof navigator !== "undefined" ? [...navigator.languages] : [])
const tr = (key: MessageKey): string => resolveMessage(LOCALE, key)

const CODES: RunErrorCode[] = [
  "token_budget_exceeded",
  "recursion_limit_exceeded",
  "assembly_failed",
  "enqueue_failed",
  "dispatch_exhausted",
  "contract_incompatible",
  "internal_error",
]

function failedThread(code: RunErrorCode, message: string): SessionStreamState {
  const thread = createSessionStreamState()
  return {
    ...thread,
    messages: [
      { id: "m_u", role: "user", content: "do the thing", runId: "m_u" },
      { id: "m_a", role: "assistant", content: "working…", runId: "run_1" },
    ],
    stepsByRun: { run_1: [] },
    runStatus: "failed",
    runError: { code, message },
  }
}

function renderFailure(
  thread: SessionStreamState,
  onRetry = vi.fn(),
  options: { creditRejected?: boolean; onOpenPricing?: () => void } = {},
) {
  return render(
    <LegacyConversationThread
      sessionId="ses_1"
      thread={thread}
      isStreaming={false}
      isReconnecting={false}
      hasFailed
      creditRejected={options.creditRejected ?? false}
      onOpenBilling={vi.fn()}
      onOpenPricing={options.onOpenPricing}
      onRetry={onRetry}
      onScroll={vi.fn()}
      threadEndRef={createRef()}
      mode="fast"
      stagingByRun={{}}
      hitlRunId={null}
      controlError={null}
    />,
    { wrapper: LocaleProvider },
  )
}

afterEach(cleanup)

describe("failureCopyKey — 闭集 7 码逐码本地化", () => {
  it("每个闭集码映射到一个存在的、非通用的文案键", () => {
    for (const code of CODES) {
      const key = failureCopyKey({ code, message: "x" })
      expect(key).not.toBe("fail.generic")
      expect(zh[key]).toBeTruthy()
    }
  })

  it("七码映射两两不同（无碰撞）", () => {
    const keys = CODES.map((code) => failureCopyKey({ code, message: "x" }))
    expect(new Set(keys).size).toBe(CODES.length)
  })

  it("未知码与 null 兜底通用句", () => {
    expect(failureCopyKey({ code: "totally_unknown", message: "x" })).toBe("fail.generic")
    expect(failureCopyKey(null)).toBe("fail.generic")
  })
})

describe("ConversationThread 失败卡渲染", () => {
  it("每个闭集码渲染对应本地化人话（绝不裸露错误码）", () => {
    for (const code of CODES) {
      renderFailure(failedThread(code, "raw diagnostic"))
      const key = failureCopyKey({ code, message: "x" })
      expect(screen.getByText(tr(key))).toBeTruthy()
      // 裸码绝不出现在可见文案里。
      expect(screen.queryByText(code)).toBeNull()
      cleanup()
    }
  })

  it("message 原文折叠可展开", () => {
    renderFailure(failedThread("internal_error", "boom at line 42"))
    const detail = screen.getByText("boom at line 42")
    expect(detail.tagName.toLowerCase()).toBe("pre")
    expect(screen.getByText(tr("fail.showDetail"))).toBeTruthy()
  })

  it("internal_error 额外给反馈指引", () => {
    renderFailure(failedThread("internal_error", "boom"))
    expect(screen.getByText(tr("fail.internalHint"))).toBeTruthy()
  })

  it("非 internal_error 不显示反馈指引", () => {
    renderFailure(failedThread("enqueue_failed", "boom"))
    expect(screen.queryByText(tr("fail.internalHint"))).toBeNull()
  })

  it("重试按钮触发 onRetry（重发原消息）", () => {
    const onRetry = vi.fn()
    renderFailure(failedThread("dispatch_exhausted", "boom"), onRetry)
    fireEvent.click(screen.getByText(tr("thread.retry")))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("余额不足只提供余额入口，不渲染套餐购买导航", () => {
    const onOpenPricing = vi.fn()
    renderFailure(failedThread("internal_error", "credit_insufficient"), vi.fn(), {
      creditRejected: true,
      onOpenPricing,
    })
    const alert = screen.getByRole("alert")
    for (const button of alert.querySelectorAll("button")) fireEvent.click(button)
    expect(onOpenPricing).not.toHaveBeenCalled()
  })
})
