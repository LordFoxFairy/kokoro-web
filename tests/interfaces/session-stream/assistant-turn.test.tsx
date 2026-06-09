import { cleanup, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type {
  SessionMessage,
  SessionStep,
} from "@/application/session-stream-reducer"
import { AssistantTurn } from "@/interfaces/session-stream/components/assistant-turn"

afterEach(cleanup)

const answer: SessionMessage = {
  id: "m1",
  role: "assistant",
  content: "正在生长的回答",
  runId: "run_01",
}

function textStep(messageId: string, seq: number): SessionStep {
  return { kind: "text", seq, messageId }
}

describe("AssistantTurn streaming caret", () => {
  it("renders a trailing blink caret on the tail text while live", () => {
    // 为什么重要：正在生长的助手气泡需要就近的「正在出字」可视线索——
    // 在 Markdown 正文之后跟一个内联闪烁光标，且对读屏隐藏（aria-hidden）。
    const { container } = render(
      <AssistantTurn
        steps={[textStep("m1", 1)]}
        messagesById={{ m1: answer }}
        isLive
      />,
    )

    const caret = container.querySelector(".kk-caret")
    expect(caret).not.toBeNull()
    expect(caret).toHaveAttribute("aria-hidden")
    // 光标紧跟在正文气泡内（与文本同处一个气泡），而非游离在外。
    expect(caret?.closest(".kk-msg__bubble")).not.toBeNull()
  })

  it("does not render the caret once the turn has settled", () => {
    const { container } = render(
      <AssistantTurn
        steps={[textStep("m1", 1)]}
        messagesById={{ m1: answer }}
        isLive={false}
      />,
    )

    expect(container.querySelector(".kk-caret")).toBeNull()
  })

  it("does not render the caret when live but no text step yet", () => {
    // 过程先到、正文未到：这一段没有文本气泡，光标无处可挂。
    const { container } = render(
      <AssistantTurn
        steps={[{ kind: "thinking", seq: 1, messageId: "m1", text: "想" }]}
        messagesById={{}}
        isLive
      />,
    )

    expect(container.querySelector(".kk-caret")).toBeNull()
  })

  it("puts the caret only on the LAST text step, not earlier ones", () => {
    // 唯一锚点：交错的多段文本里，只有末尾正在生长的那一段带光标。
    const first: SessionMessage = { id: "m1", role: "assistant", content: "第一段", runId: "run_01" }
    const second: SessionMessage = { id: "m2", role: "assistant", content: "第二段", runId: "run_01" }
    const { container } = render(
      <AssistantTurn
        steps={[textStep("m1", 1), textStep("m2", 3)]}
        messagesById={{ m1: first, m2: second }}
        isLive
      />,
    )

    const carets = container.querySelectorAll(".kk-caret")
    expect(carets).toHaveLength(1)
    expect(carets[0]?.closest(".kk-turn__segment")).toContainElement(
      container.querySelector(
        ".kk-turn__segment:last-child .kk-msg__bubble",
      ) as HTMLElement,
    )
  })
})

describe("AssistantTurn structure (one avatar per turn)", () => {
  it("renders exactly ONE bot avatar for a multi-segment turn", () => {
    // 核心不变量：一轮（一个 runId）只一个头像，不分段、不为成形态另起。
    const first: SessionMessage = { id: "m1", role: "assistant", content: "第一段", runId: "run_01" }
    const second: SessionMessage = { id: "m2", role: "assistant", content: "第二段", runId: "run_01" }
    const { container } = render(
      <AssistantTurn
        steps={[textStep("m1", 1), textStep("m2", 2)]}
        messagesById={{ m1: first, m2: second }}
        isLive={false}
      />,
    )

    expect(container.querySelectorAll(".kk-turn__avatar--bot")).toHaveLength(1)
    // 两段文本各自成步骤，挂在同一条脊上。
    expect(container.querySelectorAll(".kk-turn__answer")).toHaveLength(2)
  })

  it("lights the single avatar while live, not when settled", () => {
    const { container, rerender } = render(
      <AssistantTurn steps={[textStep("m1", 1)]} messagesById={{ m1: answer }} isLive />,
    )
    expect(container.querySelector(".kk-msg__avatar--live")).not.toBeNull()

    rerender(
      <AssistantTurn
        steps={[textStep("m1", 1)]}
        messagesById={{ m1: answer }}
        isLive={false}
      />,
    )
    expect(container.querySelector(".kk-msg__avatar--live")).toBeNull()
  })

  it("renders the answer bubble ABOVE its process, with the segment's tools hanging below it", () => {
    // 机器人一段信息 = 文本气泡在上、它的过程（思考/该段工具）挂在下面（次级、可折叠）。
    const steps: SessionStep[] = [
      { kind: "thinking", seq: 1, messageId: "m1", text: "先想" },
      {
        kind: "tool",
        seq: 2,
        messageId: "m1",
        tool: { id: "t1", name: "get_weather", args: {}, status: "done", result: "晴" },
      },
      textStep("m1", 3),
    ]
    const { container } = render(
      <AssistantTurn steps={steps} messagesById={{ m1: answer }} isLive={false} />,
    )

    const segment = container.querySelector(".kk-turn__segment") as HTMLElement
    const children = Array.from(segment.children)
    // 气泡在上、过程块在下。
    const bubbleIndex = children.findIndex((el) =>
      el.classList.contains("kk-turn__answer"),
    )
    const processIndex = children.findIndex((el) =>
      el.classList.contains("kk-process"),
    )
    expect(bubbleIndex).toBeGreaterThanOrEqual(0)
    expect(processIndex).toBeGreaterThan(bubbleIndex)
    // 该段的工具就近挂在它的过程块里。
    expect(within(segment).getByText("get_weather")).toBeInTheDocument()
    expect(within(segment).getByText("正在生长的回答")).toBeInTheDocument()
  })

  it("shows a forming placeholder (not an empty bubble) for the tail segment whose text has not arrived", () => {
    // 工具→文本→工具→[文本未到]：尾段过程已到、正文未到——气泡位给一个「正在…」成形占位，
    // 工具挂在下面，绝不是一个空气泡；正文一到就地替换。
    const steps: SessionStep[] = [
      textStep("m1", 1),
      {
        kind: "tool",
        seq: 2,
        messageId: "m2",
        tool: { id: "t2", name: "air_quality", args: { city: "北京" }, status: "running" },
      },
    ]
    const first: SessionMessage = {
      id: "m1",
      role: "assistant",
      content: "第一段已答。",
      runId: "run_01",
    }
    const { container } = render(
      <AssistantTurn
        steps={steps}
        messagesById={{ m1: first }}
        isLive
        mode="thinking"
      />,
    )

    const segments = container.querySelectorAll(".kk-turn__segment")
    expect(segments).toHaveLength(2)
    const tail = segments[1] as HTMLElement
    const forming = tail.querySelector(".kk-msg__bubble--forming")
    // 成形占位（非空气泡）在上，工具过程在下。
    expect(forming).not.toBeNull()
    expect(forming?.textContent).toMatch(/正在/)
    expect(within(tail).getByText("air_quality")).toBeInTheDocument()
  })
})
