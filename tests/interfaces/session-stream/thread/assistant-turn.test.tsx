import { cleanup, render, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type {
  SessionMessage,
  SessionStep,
} from "@/application/session-stream/reducer"
import { AssistantTurn } from "@/interfaces/session-stream/components/thread/assistant-turn"

afterEach(cleanup)

const answer: SessionMessage = {
  id: "m1",
  role: "assistant",
  content: "正在生长的回答",
  runId: "run_01",
}

function textStep(segmentId: string, seq: number): SessionStep {
  return { kind: "text", seq, segmentId }
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
        steps={[{ kind: "thinking", seq: 1, segmentId: "m1", text: "想" }]}
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

describe("AssistantTurn shared answer-bubble skeleton (A1)", () => {
  it("tags the box data-state=streaming on a live tail segment with text", () => {
    const { container } = render(
      <AssistantTurn steps={[textStep("m1", 1)]} messagesById={{ m1: answer }} isLive />,
    )
    expect(
      container.querySelector(".kk-turn__answer[data-state='streaming']"),
    ).not.toBeNull()
  })

  it("tags the box data-state=settled once the turn settles", () => {
    const { container } = render(
      <AssistantTurn
        steps={[textStep("m1", 1)]}
        messagesById={{ m1: answer }}
        isLive={false}
      />,
    )
    expect(
      container.querySelector(".kk-turn__answer[data-state='settled']"),
    ).not.toBeNull()
  })

  it("reuses the SAME box element across forming→streaming (no remount, no box jump)", () => {
    // A1 核心不变量：尾段从 forming（过程先到、正文未到）到 streaming（正文到）必须复用
    // 同一个 .kk-turn__answer DOM 元素——只换盒内内容，整盒不卸载重挂。用元素身份证明。
    const steps: SessionStep[] = [
      { kind: "thinking", seq: 1, segmentId: "m1", text: "先想" },
    ]
    const { container, rerender } = render(
      <AssistantTurn steps={steps} messagesById={{}} isLive />,
    )
    const formingBox = container.querySelector(".kk-turn__answer")
    expect(formingBox?.getAttribute("data-state")).toBe("forming")

    // 正文到达：同段加一个 text step + message。
    rerender(
      <AssistantTurn
        steps={[...steps, textStep("m1", 2)]}
        messagesById={{ m1: answer }}
        isLive
      />,
    )
    const streamingBox = container.querySelector(".kk-turn__answer")
    expect(streamingBox?.getAttribute("data-state")).toBe("streaming")
    // 同一个 DOM 节点被复用（身份相等），而非新建——这才是「整盒不跳」。
    expect(streamingBox).toBe(formingBox)
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
      { kind: "thinking", seq: 1, segmentId: "m1", text: "先想" },
      {
        kind: "tool",
        seq: 2,
        segmentId: "m1",
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

  it("renders a non-blank forming scaffold when live with zero segments", () => {
    // 为什么重要：提交后、首个 step/token 未到时，在途轮不能塌成空白——
    // 即使没有任何 segment，也要给一个 live 头像 + 单条「正在…」成形线，绝不空帧。
    const { container } = render(
      <AssistantTurn steps={[]} messagesById={{}} isLive />,
    )

    // 仍是一轮：一个点亮的头像。
    expect(container.querySelectorAll(".kk-turn__avatar--bot")).toHaveLength(1)
    expect(container.querySelector(".kk-msg__avatar--live")).not.toBeNull()
    // 单条成形占位，文案为「正在…」。
    const forming = container.querySelector(".kk-turn__answer[data-state='forming']")
    expect(forming).not.toBeNull()
    expect(forming?.textContent).toMatch(/正在/)
  })

  it("renders nothing extra when settled with zero segments (no scaffold)", () => {
    // 落定/非流式且无内容：不得冒出成形占位（避免空轮残留一个孤零零的「正在…」）。
    const { container } = render(
      <AssistantTurn steps={[]} messagesById={{}} isLive={false} />,
    )
    expect(container.querySelector(".kk-turn__answer[data-state='forming']")).toBeNull()
  })

  it("shows a forming placeholder (not an empty bubble) for the tail segment whose text has not arrived", () => {
    // 工具→文本→工具→[文本未到]：尾段过程已到、正文未到——气泡位给一个「正在…」成形占位，
    // 工具挂在下面，绝不是一个空气泡；正文一到就地替换。
    const steps: SessionStep[] = [
      textStep("m1", 1),
      {
        kind: "tool",
        seq: 2,
        segmentId: "m2",
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
    const forming = tail.querySelector(".kk-turn__answer[data-state='forming']")
    // 成形占位（非空气泡）在上，工具过程在下。
    expect(forming).not.toBeNull()
    expect(forming?.textContent).toMatch(/正在/)
    expect(within(tail).getByText("air_quality")).toBeInTheDocument()
  })
})
