import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionMessage } from "@/application/session-stream-reducer"
import { AssistantTurn } from "@/interfaces/session-stream/components/assistant-turn"

afterEach(cleanup)

const message: SessionMessage = {
  id: "m1",
  role: "assistant",
  content: "正在生长的回答",
}

describe("AssistantTurn streaming caret", () => {
  it("renders a trailing blink caret while streaming with message text", () => {
    // 为什么重要：正在生长的助手气泡需要就近的「正在出字」可视线索——
    // 在 Markdown 正文之后跟一个内联闪烁光标，且对读屏隐藏（aria-hidden）。
    const { container } = render(
      <AssistantTurn
        message={message}
        isStreamingAssistant
        isStreaming
      />,
    )

    const caret = container.querySelector(".kk-caret")
    expect(caret).not.toBeNull()
    expect(caret).toHaveAttribute("aria-hidden")
    // 光标紧跟在正文气泡内（与文本同处一个气泡），而非游离在外。
    expect(caret?.closest(".kk-msg__bubble")).not.toBeNull()
  })

  it("does not render the caret once the turn has settled", () => {
    // 为什么重要：落定后不再出字，光标必须消失，避免静态气泡仍在「假装打字」。
    const { container } = render(
      <AssistantTurn
        message={message}
        isStreamingAssistant={false}
        isStreaming={false}
      />,
    )

    expect(container.querySelector(".kk-caret")).toBeNull()
  })

  it("does not render the caret when streaming but no message text yet", () => {
    // 为什么重要：过程先到、正文未到时这一段没有文本气泡，光标无处可挂，
    // 不能在空段落里凭空冒出一个光标。
    const { container } = render(
      <AssistantTurn isStreamingAssistant isStreaming />,
    )

    expect(container.querySelector(".kk-caret")).toBeNull()
  })
})
