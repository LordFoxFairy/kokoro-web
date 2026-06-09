import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  StartReply,
  StartReplyInput,
} from "@/application/session-stream-preview"
import type { ReattachReply } from "@/interfaces/session-stream/hooks/use-conversation"
import { applySessionEvent } from "@/application/session-stream-reducer"
import { SessionShell } from "@/interfaces/session-stream/session-shell"

afterEach(() => {
  cleanup()
  // jsdom 的 localStorage 在用例间是共享的，必须清掉以隔离持久化断言。
  window.localStorage.clear()
})

const STORAGE_KEY = "kokoro:conversations"

const envelope = { sessionId: "ses_01", conversationId: "conv_01" }

let stubCounter = 0

// 同步回复桩：把一条 assistant 终态折进 thread 并立即 settle，
// 让组件测试无需计时器即可断言渲染结果。每次调用用唯一 id，避免多轮被去重吞掉。
function instantReply(makeText: (input: string) => string): StartReply {
  return ({ input, initialState, onState, onSettled }: StartReplyInput) => {
    stubCounter += 1
    const id = stubCounter
    const completed = applySessionEvent(initialState, {
      kind: "message-completed",
      eventId: `stub-c-${id}`,
      seq: 1,
      ...envelope,
      runId: `stub-run-${id}`,
      messageId: `stub-msg-${id}`,
      role: "assistant",
      content: makeText(input),
    })
    const done = applySessionEvent(completed, {
      kind: "run-completed",
      eventId: `stub-done-${id}`,
      seq: 1,
      ...envelope,
      runId: `stub-run-${id}`,
    })
    onState(done)
    onSettled?.("preview")
    return { close: () => {} }
  }
}


// 流式中桩：推一条增量但永不 settle，组件应停留在 streaming 态。
const neverSettles: StartReply = ({
  initialState,
  onState,
}: StartReplyInput) => {
  stubCounter += 1
  const partial = applySessionEvent(initialState, {
    kind: "message-delta",
    eventId: `stub-d-${stubCounter}`,
    seq: 1,
    ...envelope,
    runId: `stub-run-${stubCounter}`,
    messageId: `stub-msg-${stubCounter}`,
    role: "assistant",
    delta: "正在",
  })
  onState(partial)
  return { close: () => {} }
}

// 可观测的流式中桩：增量带可断言文本，close 是 spy，
// 用于验证停止会调用句柄 close 且不擦除已收到的部分气泡。
function spyableNeverSettles(partialText: string): {
  start: StartReply
  close: ReturnType<typeof vi.fn>
} {
  const close = vi.fn()
  const start: StartReply = ({ initialState, onState }: StartReplyInput) => {
    stubCounter += 1
    const partial = applySessionEvent(initialState, {
      kind: "message-delta",
      eventId: `stub-d-${stubCounter}`,
      seq: 1,
      ...envelope,
      runId: `stub-run-${stubCounter}`,
      messageId: `stub-msg-${stubCounter}`,
      role: "assistant",
      delta: partialText,
    })
    onState(partial)
    return { close }
  }
  return { start, close }
}

const failingReply: StartReply = ({
  initialState,
  onState,
  onSettled,
}: StartReplyInput) => {
  stubCounter += 1
  const failed = applySessionEvent(initialState, {
    kind: "run-failed",
    eventId: `stub-f-${stubCounter}`,
    seq: 1,
    ...envelope,
    runId: `stub-run-${stubCounter}`,
    errorKind: "agent_error",
    message: "boom",
  })
  onState(failed)
  onSettled?.("preview")
  return { close: () => {} }
}

// 失败→成功桩：第一次调用以 run-failed 收尾，第二次（重试）以 assistant 终态成功收尾。
// 记录每次收到的 input，用于断言重试复用了同一句输入。
function failThenSucceed(): {
  start: StartReply
  inputs: string[]
} {
  const inputs: string[] = []
  const start: StartReply = ({
    input,
    initialState,
    onState,
    onSettled,
  }: StartReplyInput) => {
    inputs.push(input)
    stubCounter += 1
    const id = stubCounter
    const first = inputs.length === 1

    const settled = first
      ? applySessionEvent(initialState, {
          kind: "run-failed",
          eventId: `fts-f-${id}`,
          seq: 1,
          ...envelope,
          runId: `fts-run-${id}`,
          errorKind: "agent_error",
          message: "boom",
        })
      : applySessionEvent(
          applySessionEvent(initialState, {
            kind: "message-completed",
            eventId: `fts-c-${id}`,
            seq: 1,
            ...envelope,
            runId: `fts-run-${id}`,
            messageId: `fts-msg-${id}`,
            role: "assistant",
            content: `恢复：${input}`,
          }),
          {
            kind: "run-completed",
            eventId: `fts-done-${id}`,
            seq: 1,
            ...envelope,
            runId: `fts-run-${id}`,
          },
        )

    onState(settled)
    onSettled?.("preview")
    return { close: () => {} }
  }
  return { start, inputs }
}

function send(text: string) {
  const input = screen.getByLabelText("对话输入")
  fireEvent.change(input, { target: { value: text } })
  fireEvent.keyDown(input, { key: "Enter" })
}

// 对话区内查找：rail 的历史会话标题会与首条用户消息同文，把消息断言限定在 log 内消歧。
function inLog(text: string) {
  return within(screen.getByRole("log")).getByText(text)
}

// 把滚动容器的几何强制成“已上滑”，再派发 scroll，让组件判定为非贴底。
// jsdom 下这些尺寸恒为 0，必须显式注入才能驱动近底/远底分支。
function scrollThreadUp() {
  const thread = screen.getByRole("log")
  Object.defineProperty(thread, "scrollTop", { value: 0, configurable: true })
  Object.defineProperty(thread, "scrollHeight", {
    value: 1000,
    configurable: true,
  })
  Object.defineProperty(thread, "clientHeight", {
    value: 300,
    configurable: true,
  })
  fireEvent.scroll(thread)
}

describe("SessionShell first screen", () => {
  it("renders the approved minimal first screen when empty", () => {
    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(screen.getByText("Kokoro")).toBeInTheDocument()
    expect(screen.getByText("新对话")).toBeInTheDocument()
    expect(screen.getByText("搜索")).toBeInTheDocument()
    expect(screen.getByText("当前用户")).toBeInTheDocument()

    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
    expect(screen.getByText("不急，先把想法说给我")).toBeInTheDocument()

    // composer 现在是真实输入框：占位文案从静态正文变为 placeholder。
    expect(screen.getByPlaceholderText("把想说的告诉我。")).toBeInTheDocument()
    expect(screen.getAllByText("Fast").length).toBeGreaterThan(0)

    expect(screen.queryByText("A2UI artifact preview")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Protocol-first chat shell for AGUI + SSE replay."),
    ).not.toBeInTheDocument()
  })

  it("keeps the calmer composer controls visible by default", () => {
    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(screen.getByLabelText("对话输入")).toBeInTheDocument()
    expect(screen.getByLabelText("附加内容")).toBeInTheDocument()
    expect(screen.getByLabelText("切换模式")).toBeInTheDocument()
    expect(screen.getByLabelText("语音输入")).toBeInTheDocument()
    expect(screen.getByLabelText("发送消息")).toBeInTheDocument()
  })

  it("does not send empty or whitespace-only drafts", () => {
    render(<SessionShell startReply={instantReply((input) => input)} />)

    const input = screen.getByLabelText("对话输入")
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })

    // 仍停留在空首屏：hero 还在，没有产生任何对话气泡。
    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
  })

  it("does not send on Enter while an IME composition is active", () => {
    // 为什么重要：中文拼音选词时的 Enter 只是确认候选词，绝不能当作发送，
    // 否则会把半截未上屏的句子提前发出去。守卫必须看 isComposing，且只拦合成期。
    const start = vi.fn(instantReply((input) => input))
    render(<SessionShell startReply={start} />)

    const input = screen.getByLabelText("对话输入")
    fireEvent.change(input, { target: { value: "你好" } })

    // 合成期 Enter（选词确认）：不得发起任何回复，仍停留在空首屏。
    fireEvent.keyDown(input, { key: "Enter", isComposing: true })
    expect(start).not.toHaveBeenCalled()
    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()

    // 合成结束后的普通 Enter 正常发送——确认守卫只拦合成期、不误伤正常发送。
    fireEvent.keyDown(input, { key: "Enter" })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("opens an enlarged editor that mirrors the draft and collapses on Escape", () => {
    // 为什么重要：放大编辑与内联输入框是同一份草稿的两个视图，必须双向同步、
    // 收起后内容保留——否则用户在大面板里写的长文会丢失。Esc 是其约定的收起键。
    render(<SessionShell startReply={instantReply((input) => input)} />)

    const input = screen.getByLabelText("对话输入")
    fireEvent.change(input, { target: { value: "草稿内容" } })

    // 打开放大编辑：出现模态对话框，大编辑框镜像当前草稿。
    fireEvent.click(screen.getByLabelText("放大编辑"))
    expect(screen.getByRole("dialog", { name: "放大编辑" })).toBeInTheDocument()
    const big = screen.getByLabelText("放大编辑输入")
    expect(big).toHaveValue("草稿内容")

    // 在大编辑框续写会同步回内联输入框（受控于同一份 state）。
    fireEvent.change(big, { target: { value: "草稿内容——续写" } })
    expect(screen.getByLabelText("对话输入")).toHaveValue("草稿内容——续写")

    // Esc 收起：对话框消失，内容完整保留在内联输入框，绝不丢失。
    fireEvent.keyDown(big, { key: "Escape" })
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(screen.getByLabelText("对话输入")).toHaveValue("草稿内容——续写")
  })
})

describe("SessionShell starter chips", () => {
  it("offers starter template chips on the empty hero", () => {
    // 为什么重要：空首屏给出创作模板入口，降低“从零打字”的启动成本（对齐原型 chip 行）。
    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(screen.getByRole("group", { name: "创作模板" })).toBeInTheDocument()
    expect(screen.getByText("学习课件")).toBeInTheDocument()
    expect(screen.getByText("想法可视化")).toBeInTheDocument()
    // 营销类（海报/落地页）已按用户要求去掉。
    expect(screen.queryByText("小红书风海报")).not.toBeInTheDocument()
    expect(screen.queryByText("一页落地页")).not.toBeInTheDocument()
  })

  it("prefills the composer with a chip's prompt instead of sending", () => {
    // 为什么重要：点击模板只预填输入框、把光标交给用户续写，绝不直接发起一轮——
    // 用户仍要补全主题再发送。误把它做成立即发送会丢失用户意图。
    const start = vi.fn(instantReply((input) => input))
    render(<SessionShell startReply={start} />)

    fireEvent.click(screen.getByText("学习课件"))

    // 输入框被预填为该模板的起始句。
    expect(screen.getByLabelText("对话输入")).toHaveValue(
      "帮我做一份学习课件，讲清楚",
    )
    // 关键：没有发起任何回复，仍停留在空首屏（hero 在场）。
    expect(start).not.toHaveBeenCalled()
    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
  })

  it("hides the starter chips once a conversation begins", () => {
    // 为什么重要：chips 只属于空首屏；进入对话态后必须让位给对话线，不得残留。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("开始聊")

    expect(
      screen.queryByRole("group", { name: "创作模板" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("小红书风海报")).not.toBeInTheDocument()
  })
})

describe("SessionShell conversation", () => {
  it("shows the user message immediately and renders the assistant reply", () => {
    render(<SessionShell startReply={instantReply((input) => `回声：${input}`)} />)

    send("帮我理理今天")

    expect(inLog("帮我理理今天")).toBeInTheDocument()
    expect(screen.getByText("回声：帮我理理今天")).toBeInTheDocument()
    // 进入对话态后 hero 让位给对话线。
    expect(
      screen.queryByRole("heading", { name: "今天想做什么？" }),
    ).not.toBeInTheDocument()
    // 发送后草稿清空。
    expect(screen.getByLabelText("对话输入")).toHaveValue("")
  })

  it("disables the input while a reply is still streaming", () => {
    render(<SessionShell startReply={neverSettles} />)

    send("在吗")

    expect(inLog("在吗")).toBeInTheDocument()
    // 流式中：输入禁用 + 单一控件切到停止。常驻状态条（「正在输入」）已撤除，
    // 流式存在感由「在途轮的动态头像 + 答案光标 + 停止控件」承担（live anchor 由后续阶段细化）。
    expect(screen.getByLabelText("对话输入")).toBeDisabled()
    expect(screen.getByLabelText("停止生成")).toBeInTheDocument()
  })

  it("accumulates earlier turns across a second exchange", () => {
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("第一句")
    send("第二句")

    // 两轮的用户与 assistant 消息都必须保留，时间线不能被新一轮清空。
    expect(inLog("第一句")).toBeInTheDocument()
    expect(screen.getByText("答：第一句")).toBeInTheDocument()
    expect(screen.getByText("第二句")).toBeInTheDocument()
    expect(screen.getByText("答：第二句")).toBeInTheDocument()
  })

  it("surfaces an inline error and re-enables the input on a failed run", () => {
    render(<SessionShell startReply={failingReply} />)

    send("会失败的一轮")

    expect(inLog("会失败的一轮")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("这一轮没能完成")
    expect(screen.getByText(/Fast · 这轮未完成/)).toBeInTheDocument()
    expect(screen.getByText("这轮快速回应没能完成，请再试一次")).toBeInTheDocument()
    // 失败后输入框恢复可用，用户可以重试。
    expect(screen.getByLabelText("对话输入")).not.toBeDisabled()
  })
})

// 提交后、首个 step/token 未到时永不留空帧：在途轮始终有一个 live 脚手架。
const noFirstToken: StartReply = ({ onState, initialState }: StartReplyInput) => {
  // 既不推任何 step，也不推任何 assistant 文本——只把流式态保持住（永不 settle）。
  // 调一次 onState 维持 preview/live transport，但 thread 内容与提交时一致（仅用户气泡）。
  onState(initialState)
  return { close: () => {} }
}

describe("SessionShell submitted-no-token scaffold", () => {
  it("never shows a blank frame between submit and first token", () => {
    // 为什么重要：撤掉全局「正在输入」状态条后，提交到首 token 之间不能是空白——
    // 在途轮必须立刻给一个 live 脚手架（一个点亮头像 + 单条「正在…」成形线）。
    const { container } = render(<SessionShell startReply={noFirstToken} />)

    send("还没有任何 token")

    // 用户气泡在场。
    expect(inLog("还没有任何 token")).toBeInTheDocument()
    // 恰好一个在途助手轮，头像点亮。
    const turns = container.querySelectorAll(".kk-turn--assistant")
    expect(turns).toHaveLength(1)
    expect(container.querySelectorAll(".kk-msg__avatar--live")).toHaveLength(1)
    // 成形占位（「正在…」）在场——不是空帧。
    const forming = container.querySelector(".kk-msg__bubble--forming")
    expect(forming).not.toBeNull()
    expect(forming?.textContent).toMatch(/正在/)
  })

  it("does not synthesize a live turn when not streaming", () => {
    // 落定/静息态：绝不冒出一个空的成形脚手架。
    const { container } = render(
      <SessionShell startReply={instantReply((input) => `答：${input}`)} />,
    )

    send("正常一轮")

    expect(screen.getByText("答：正常一轮")).toBeInTheDocument()
    // 已落定：无成形占位、无 live 头像。
    expect(container.querySelector(".kk-msg__bubble--forming")).toBeNull()
    expect(container.querySelector(".kk-msg__avatar--live")).toBeNull()
  })
})

describe("SessionShell single live anchor", () => {
  it("keeps at most one caret and one forming pulse across a multi-turn thread", () => {
    // 为什么重要：全线程只允许一个「live」脉冲锚点——只在在途轮的尾段。
    // 历史已落定的轮与更早的段绝不带 caret/成形脉冲。
    const { container } = render(
      <SessionShell startReply={instantReply((input) => `答：${input}`)} />,
    )

    // 先完成一轮（落定），积累一段历史。
    send("第一轮")
    expect(screen.getByText("答：第一轮")).toBeInTheDocument()
    // 落定态：零 caret、零成形脉冲。
    expect(container.querySelectorAll(".kk-caret")).toHaveLength(0)
    expect(container.querySelectorAll(".kk-msg__bubble--forming")).toHaveLength(0)
  })

  it("renders at most one caret and one forming pulse while streaming a second turn", () => {
    // 在途轮（第二轮）只有尾段带 caret；首轮历史与早段不带任何 live 锚点。
    const { start } = spyableNeverSettles("正在生长")
    const { container, rerender } = render(
      <SessionShell startReply={instantReply((input) => `答：${input}`)} />,
    )

    send("第一轮")
    expect(screen.getByText("答：第一轮")).toBeInTheDocument()

    // 切到永不 settle 的桩再发第二轮，使其停留在流式态。
    rerender(<SessionShell startReply={start} />)
    send("第二轮")

    // 全线程最多一个 caret、最多一个成形脉冲。
    expect(container.querySelectorAll(".kk-caret").length).toBeLessThanOrEqual(1)
    expect(
      container.querySelectorAll(".kk-msg__bubble--forming").length,
    ).toBeLessThanOrEqual(1)
    // 至多一个 live 头像（在途轮）。
    expect(
      container.querySelectorAll(".kk-msg__avatar--live").length,
    ).toBeLessThanOrEqual(1)
  })
})

describe("SessionShell stop control", () => {
  it("hides the stop control until a reply is streaming", () => {
    render(<SessionShell startReply={instantReply((input) => input)} />)

    // 静息态只有发送，不能出现停止——避免误导用户当前可中止。
    expect(screen.getByLabelText("发送消息")).toBeInTheDocument()
    expect(screen.queryByLabelText("停止生成")).not.toBeInTheDocument()
  })

  it("replaces send with a stop control while streaming", () => {
    render(<SessionShell startReply={neverSettles} />)

    send("在吗")

    // 流式中：单一控件从发送切到停止，不并存第二个常驻按钮。
    const stop = screen.getByLabelText("停止生成")
    expect(stop).toBeInTheDocument()
    expect(screen.queryByLabelText("发送消息")).not.toBeInTheDocument()
    // 停止必须是 type=button，否则会触发表单提交、二次发起回复。
    expect(stop).toHaveAttribute("type", "button")
  })

  it("aborts via the handle close and keeps the partial bubble on stop", () => {
    const { start, close } = spyableNeverSettles("正在拼")
    render(<SessionShell startReply={start} />)

    send("帮我想想")

    // 已收到的增量先确认在场。
    expect(screen.getByText("正在拼")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("停止生成"))

    // 中止调用真实 close 句柄（关 EventSource/计时器），而非空操作。
    expect(close).toHaveBeenCalledTimes(1)
    // 停止后退出 streaming：输入框恢复、停止控件让位给发送。
    expect(screen.getByLabelText("对话输入")).not.toBeDisabled()
    expect(screen.getByLabelText("发送消息")).toBeInTheDocument()
    expect(screen.queryByLabelText("停止生成")).not.toBeInTheDocument()
    // 关键：部分气泡不能被擦除——中止不等于丢弃已生成内容。
    expect(screen.getByText("正在拼")).toBeInTheDocument()
  })

  it("does not throw when stopping after the handle is already null", () => {
    // 句柄已是 null 的竞态：startReply 不交回任何句柄，但仍进入 streaming 态。
    const noHandle: StartReply = ({ initialState, onState }: StartReplyInput) => {
      stubCounter += 1
      const partial = applySessionEvent(initialState, {
        kind: "message-delta",
        eventId: `stub-nh-${stubCounter}`,
        seq: 1,
        ...envelope,
        runId: `stub-run-${stubCounter}`,
        messageId: `stub-msg-${stubCounter}`,
        role: "assistant",
        delta: "片段",
      })
      onState(partial)
      return null as unknown as ReturnType<StartReply>
    }
    render(<SessionShell startReply={noHandle} />)

    send("竞态")

    expect(() =>
      fireEvent.click(screen.getByLabelText("停止生成")),
    ).not.toThrow()
    expect(screen.getByLabelText("对话输入")).not.toBeDisabled()
  })

  it("shows the streaming affordance only while streaming", () => {
    const { container } = render(
      <SessionShell startReply={instantReply((input) => `答：${input}`)} />,
    )

    // instantReply 同步 settle：渲染后绝不应残留流式存在感（动态头像/停止控件均不在）。
    send("已结束")
    expect(screen.queryByLabelText("停止生成")).not.toBeInTheDocument()
    expect(container.querySelector(".kk-msg__avatar--live")).toBeNull()
  })

  it("clears the streaming affordance after a stop", () => {
    const { container } = render(<SessionShell startReply={spyableNeverSettles("半句").start} />)

    send("说点什么")
    // 流式中：在途轮头像点亮（live anchor 的雏形）+ 停止控件在场。
    expect(container.querySelector(".kk-msg__avatar--live")).not.toBeNull()
    expect(screen.getByLabelText("停止生成")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("停止生成"))
    expect(container.querySelector(".kk-msg__avatar--live")).toBeNull()
    expect(screen.queryByLabelText("停止生成")).not.toBeInTheDocument()
  })
})

describe("SessionShell new conversation reset", () => {
  it("opens a fresh empty conversation on 新对话, keeping history in the rail", () => {
    // 为什么重要：新对话必须开一段干净的新会话（hero 回归、对话线清空），
    // 同时把旧会话保留在左侧历史列表里，不丢上下文。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("第一段对话")
    expect(inLog("第一段对话")).toBeInTheDocument()
    expect(screen.getByText("答：第一段对话")).toBeInTheDocument()

    fireEvent.click(screen.getByText("新对话"))

    // 新会话是空的：hero 回归、对话线（log）消失、输入清空且聚焦。
    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
    expect(screen.queryByRole("log")).toBeNull()
    const input = screen.getByLabelText("对话输入")
    expect(input).toHaveValue("")
    expect(input).not.toBeDisabled()
    expect(input).toHaveFocus()
    // 旧会话仍在 rail 历史列表里（标题=首条消息），不丢失。
    expect(screen.getByText("第一段对话")).toBeInTheDocument()
    // 落盘的活跃会话是空的：刷新后停在空首屏。
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) as string,
    )
    const active = persisted.conversations.find(
      (entry: { id: string }) => entry.id === persisted.activeId,
    )
    expect(active.thread.messages).toEqual([])
  })

  it("aborts an active stream via the handle close on 新对话", () => {
    // 为什么重要：开新对话时若有在途回复，必须关掉句柄（EventSource/计时器），
    // 否则旧流的后续事件会折进新会话线，造成串话。
    const { start, close } = spyableNeverSettles("在途内容")
    render(<SessionShell startReply={start} />)

    send("先发一句")
    expect(screen.getByText("在途内容")).toBeInTheDocument()
    expect(screen.getByLabelText("停止生成")).toBeInTheDocument()

    fireEvent.click(screen.getByText("新对话"))

    expect(close).toHaveBeenCalledTimes(1)
    // 重置后退出 streaming：停止控件让位给发送，输入框恢复可用。
    expect(screen.queryByLabelText("停止生成")).not.toBeInTheDocument()
    expect(screen.getByLabelText("发送消息")).toBeInTheDocument()
    expect(screen.getByLabelText("对话输入")).not.toBeDisabled()
  })
})

describe("SessionShell composer ergonomics", () => {
  it("absorbs two synchronous submits into a single reply start", () => {
    // 为什么重要：isStreaming 是异步 UI 态，连发两次 Enter 时两次 submit 可能都读到旧值。
    // 同步在途守卫必须保证两次同步提交只起一条回复，避免重复发起 run/串话。
    const start = vi.fn<StartReply>(({ initialState, onState }) => {
      const partial = applySessionEvent(initialState, {
        kind: "message-delta",
        eventId: `count-${start.mock.calls.length}`,
        seq: 1,
        ...envelope,
        runId: `count-run-${start.mock.calls.length}`,
        messageId: `count-msg-${start.mock.calls.length}`,
        role: "assistant",
        delta: "片段",
      })
      onState(partial)
      // 永不 settle：在途守卫保持置位，第二次同步 submit 必须被吞掉。
      return { close: () => {} }
    })
    render(<SessionShell startReply={start} />)

    const input = screen.getByLabelText("对话输入")
    fireEvent.change(input, { target: { value: "连发" } })
    fireEvent.keyDown(input, { key: "Enter" })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(start).toHaveBeenCalledTimes(1)
  })

  it("returns focus to the composer after a reply settles", () => {
    // 为什么重要：键盘优先流——回复落定后焦点必须回到输入框，用户无需再点一次。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("继续聊")

    expect(screen.getByText("答：继续聊")).toBeInTheDocument()
    expect(document.activeElement).toBe(screen.getByLabelText("对话输入"))
  })

  it("sends a draft exactly at the max length", () => {
    // 为什么重要：上限是“不大于”而非“小于”——恰好等于上限的草稿必须能发出去。
    render(<SessionShell startReply={instantReply((input) => `收到 ${input.length}`)} />)

    const atMax = "字".repeat(4000)
    const input = screen.getByLabelText("对话输入")
    fireEvent.change(input, { target: { value: atMax } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(screen.getByText(atMax)).toBeInTheDocument()
    expect(screen.getByText("收到 4000")).toBeInTheDocument()
  })

  it("rejects an over-length draft before starting a reply and keeps it", () => {
    // 为什么重要：超长草稿必须在任何网络/模拟之前被拦截，不发起回复，且草稿原样留存供用户裁剪。
    const start = vi.fn(instantReply((input) => input))
    render(<SessionShell startReply={start} />)

    const tooLong = "字".repeat(4001)
    const input = screen.getByLabelText("对话输入")
    fireEvent.change(input, { target: { value: tooLong } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(start).not.toHaveBeenCalled()
    // 草稿不丢：仍停留在空首屏，输入框保留原文。
    expect(input).toHaveValue(tooLong)
    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
  })

  it("auto-resizes the textarea on input without crashing in jsdom", () => {
    // 为什么重要：自适应高度依赖 scrollHeight，jsdom 下恒为 0；必须照常赋值且绝不抛错。
    render(<SessionShell startReply={instantReply((input) => input)} />)

    const input = screen.getByLabelText("对话输入") as HTMLTextAreaElement
    expect(() =>
      fireEvent.change(input, { target: { value: "第一行\n第二行\n第三行" } }),
    ).not.toThrow()
    // 高度分支确实跑过：style.height 被赋值（jsdom 下 scrollHeight=0 → "0px"）。
    expect(input.style.height).toBe("0px")
  })

  it("caps the textarea maxLength at the max input length", () => {
    // 为什么重要：浏览器侧的 maxLength 是第一道闸；submit 守卫是第二道。两者必须对齐同一上限。
    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(screen.getByLabelText("对话输入")).toHaveAttribute(
      "maxlength",
      "4000",
    )
  })
})

describe("SessionShell persistence", () => {
  it("restores a valid persisted thread on mount and hides the hero", () => {
    // 为什么重要：刷新页面后用户的历史对话必须原样回来，否则会话不具连续性。
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: "c1",
        conversations: [
          {
            id: "c1",
            title: "持久化的问题",
            updatedAt: 1,
            // 活动字段省略：storedSessionStateSchema 的 .default() 会补齐。
            thread: {
              seenEventIds: ["evt_done"],
              messages: [
                { id: "u1", role: "user", content: "持久化的问题" },
                { id: "a1", role: "assistant", content: "持久化的回答" },
              ],
              runStatus: "completed",
            },
          },
        ],
      }),
    )

    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(inLog("持久化的问题")).toBeInTheDocument()
    expect(screen.getByText("持久化的回答")).toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "今天想做什么？" }),
    ).not.toBeInTheDocument()
  })

  it("ignores corrupted persisted data without crashing", () => {
    // 为什么重要：localStorage 可能被旧版本/手改/截断写坏，渲染绝不能因此抛错，
    // 必须降级回空首屏（防御性忽略）。
    window.localStorage.setItem(STORAGE_KEY, "{bad json")

    expect(() =>
      render(<SessionShell startReply={instantReply((input) => input)} />),
    ).not.toThrow()

    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
  })

  it("ignores schema-invalid persisted data without crashing", () => {
    // 为什么重要：合法 JSON 但形状不对（缺字段/枚举越界）同样不可信，
    // 必须被严格 schema 拒绝并降级回首屏，而不是把脏态塞进 reducer。
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ messages: "not-an-array", runStatus: "boom" }),
    )

    expect(() =>
      render(<SessionShell startReply={instantReply((input) => input)} />),
    ).not.toThrow()

    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
  })

  it("persists the thread to localStorage after sending a message", () => {
    // 为什么重要：会话线变化即落盘，是刷新可恢复的前提；
    // 发送一条消息后存储里必须出现这条用户气泡。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("要被持久化")

    const raw = window.localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    const persisted = JSON.parse(raw as string)
    const active = persisted.conversations.find(
      (entry: { id: string }) => entry.id === persisted.activeId,
    )
    const contents = (active.thread.messages as { content: string }[]).map(
      (message) => message.content,
    )
    expect(contents).toContain("要被持久化")
    expect(contents).toContain("答：要被持久化")
  })
})

describe("SessionShell retry on failure", () => {
  it("re-sends the preserved input and clears the error alert on success", () => {
    // 为什么重要：失败的一轮不能逼用户重新打字——重试必须复用同一句输入，
    // 恢复会话线，并在成功后撤掉错误提示（让无障碍用户得知问题已解决）。
    const { start, inputs } = failThenSucceed()
    render(<SessionShell startReply={start} />)

    send("会先失败再成功")

    // 第一轮失败：错误提示与重试按钮都在场。
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("这一轮没能完成")
    const retry = screen.getByText("重试")
    expect(retry).toBeInTheDocument()

    fireEvent.click(retry)

    // 重试复用了同一句输入（而非空串/草稿）。
    expect(inputs).toEqual(["会先失败再成功", "会先失败再成功"])
    // 用户气泡未被重复追加：对话区里仍只有一条。
    expect(
      within(screen.getByRole("log")).getAllByText("会先失败再成功"),
    ).toHaveLength(1)
    // 恢复成功：assistant 回复出现。
    expect(screen.getByText("恢复：会先失败再成功")).toBeInTheDocument()
    // 关键：错误提示已消失，无障碍用户据此得知问题已解决。
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByText("重试")).not.toBeInTheDocument()
  })

  it("does not show a retry control on a completed run", () => {
    // 为什么重要：重试只对失败轮有意义；成功轮不得冒出重试，避免误导。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("正常一轮")

    expect(screen.getByText("答：正常一轮")).toBeInTheDocument()
    expect(screen.queryByText("重试")).not.toBeInTheDocument()
  })

  it("absorbs two retry clicks into a single new reply start", () => {
    // 为什么重要：复用上一工序的同步在途守卫——连点重试不得重复发起 run。
    // 第一次点击后组件进入流式态、重试按钮消失，加上在途守卫，二次点击必须无效。
    let calls = 0
    const start: StartReply = ({ initialState, onState, onSettled }) => {
      calls += 1
      if (calls === 1) {
        // 首轮失败，露出重试。
        const failed = applySessionEvent(initialState, {
          kind: "run-failed",
          eventId: "retry-guard-f",
          seq: 1,
          ...envelope,
          runId: "retry-guard-run-1",
          errorKind: "agent_error",
          message: "boom",
        })
        onState(failed)
        onSettled?.("preview")
        return { close: () => {} }
      }
      // 重试轮：推一条增量但永不 settle，让在途守卫保持置位。
      const partial = applySessionEvent(initialState, {
        kind: "message-delta",
        eventId: "retry-guard-d",
        seq: 1,
        ...envelope,
        runId: "retry-guard-run-2",
        messageId: "retry-guard-msg",
        role: "assistant",
        delta: "重试中",
      })
      onState(partial)
      return { close: () => {} }
    }
    render(<SessionShell startReply={start} />)

    send("触发失败")

    const retry = screen.getByText("重试")
    fireEvent.click(retry)
    // 连点：同一节点的二次点击不得再次发起。
    fireEvent.click(retry)

    // 一次发送 + 一次重试 = 两次 start，第二次点击被吞掉。
    expect(calls).toBe(2)
    expect(screen.getByText("重试中")).toBeInTheDocument()
  })
})

describe("SessionShell jump-to-latest scroll", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // jsdom 不实现 scrollIntoView：注入 spy，既让自动滚动分支可执行，也可断言调用。
    scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
      writable: true,
    })
  })

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  })

  it("does not yank the view and shows a jump control when scrolled up", () => {
    // 为什么重要：用户上滑读历史时，新到的流式内容不能把视图拽回底部；
    // 取而代之浮出“回到最新”入口，把控制权交还用户。
    let push: (delta: string) => void = () => {}
    const start: StartReply = ({ initialState, onState }) => {
      let state = initialState
      push = (delta: string) => {
        state = applySessionEvent(state, {
          kind: "message-delta",
          eventId: `defer-${delta}`,
          seq: 1,
          ...envelope,
          runId: "defer-run",
          messageId: "defer-msg",
          role: "assistant",
          delta,
        })
        onState(state)
      }
      push("第一段")
      return { close: () => {} }
    }
    render(<SessionShell startReply={start} />)

    send("开始")
    // 发送会强制贴底跟随，故无“回到最新”。
    expect(screen.queryByText("回到最新")).not.toBeInTheDocument()

    // 用户上滑离开底部。
    scrollThreadUp()

    // 远底后到来的新增量：清空滚动调用计数再推送，断言未被强制滚动。
    scrollIntoView.mockClear()
    act(() => push("第二段"))

    expect(screen.getByText("第一段第二段")).toBeInTheDocument()
    // 关键：上滑期间新内容不得触发自动滚动。
    expect(scrollIntoView).not.toHaveBeenCalled()
    // 浮出回到最新入口。
    expect(screen.getByText("回到最新")).toBeInTheDocument()
  })

  it("follows the stream and shows no jump control when near bottom", () => {
    // 为什么重要：贴底跟随是默认期望——新内容到来应自动滚到最新，且不打扰用户加按钮。
    let push: (delta: string) => void = () => {}
    const start: StartReply = ({ initialState, onState }) => {
      let state = initialState
      push = (delta: string) => {
        state = applySessionEvent(state, {
          kind: "message-delta",
          eventId: `near-${delta}`,
          seq: 1,
          ...envelope,
          runId: "near-run",
          messageId: "near-msg",
          role: "assistant",
          delta,
        })
        onState(state)
      }
      push("半句")
      return { close: () => {} }
    }
    render(<SessionShell startReply={start} />)

    send("贴底发送")
    scrollIntoView.mockClear()

    // jsdom 几何恒为 0 → 默认判定贴底；新增量应触发自动滚动。
    act(() => push("续上"))

    expect(screen.getByText("半句续上")).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalled()
    expect(screen.queryByText("回到最新")).not.toBeInTheDocument()
  })

  it("jump-to-latest scrolls down and hides the control", () => {
    // 为什么重要：“回到最新”必须真的把视图拉回底部并自我隐藏，否则只是装饰。
    let push: (delta: string) => void = () => {}
    const start: StartReply = ({ initialState, onState }) => {
      let state = initialState
      push = (delta: string) => {
        state = applySessionEvent(state, {
          kind: "message-delta",
          eventId: `jump-${delta}`,
          seq: 1,
          ...envelope,
          runId: "jump-run",
          messageId: "jump-msg",
          role: "assistant",
          delta,
        })
        onState(state)
      }
      push("内容")
      return { close: () => {} }
    }
    render(<SessionShell startReply={start} />)

    send("发送")
    scrollThreadUp()
    act(() => push("更多"))

    const jump = screen.getByText("回到最新")
    scrollIntoView.mockClear()
    fireEvent.click(jump)

    expect(scrollIntoView).toHaveBeenCalled()
    expect(screen.queryByText("回到最新")).not.toBeInTheDocument()
  })

  it("sending always scrolls to latest and hides the jump control", () => {
    // 为什么重要：无论用户此前是否上滑，主动发送一轮都应回到最新并收起“回到最新”。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("第一句")
    scrollThreadUp()
    expect(screen.getByText("回到最新")).toBeInTheDocument()

    scrollIntoView.mockClear()
    send("第二句")

    expect(scrollIntoView).toHaveBeenCalled()
    expect(screen.queryByText("回到最新")).not.toBeInTheDocument()
  })
})

describe("SessionShell accessibility roles and labels", () => {
  it("names the composer form for message editing, distinct from the send action", () => {
    // 为什么重要：表单旧标签“开始新对话”名实不符（它其实是消息编辑/发送区），
    // 会误导屏幕阅读器用户。表单名必须改为消息编辑区，且不得与发送按钮同名——
    // 同名嵌套会让 getByLabelText 命中两个元素，也是无障碍上的重名反模式。
    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(
      screen.getByRole("form", { name: "消息编辑区" }),
    ).toBeInTheDocument()
    // 旧的错误标签必须彻底消失。
    expect(screen.queryByRole("form", { name: "开始新对话" })).toBeNull()
    // 发送动作仍由按钮独占“发送消息”，且唯一可达（不与表单重名）。
    expect(screen.getByLabelText("发送消息").tagName).toBe("BUTTON")
  })

  it("keeps the conversation input label intact", () => {
    // 为什么重要：无障碍前序工序依赖 textarea 的稳定标签“对话输入”定位；
    // 本次润色不得动它，否则键盘/读屏用户的入口名会漂移。
    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(screen.getByLabelText("对话输入").tagName).toBe("TEXTAREA")
  })

  it("exposes the thread as a polite live log so streamed text announces", () => {
    // 为什么重要：流式回复要被读屏增量播报，对话线必须是 role=log + aria-live=polite；
    // 这是渐进式公告的契约，丢失任一属性，盲用户就听不到新到的回复。
    render(<SessionShell startReply={neverSettles} />)

    send("在吗")

    const log = screen.getByRole("log")
    expect(log).toHaveAttribute("aria-live", "polite")
  })

  it("wraps the streaming assistant bubble as an atomic announcement", () => {
    // 为什么重要：正在生长的助手气泡用 aria-atomic 整体播报每次增量，
    // 而不是把整条 log 重读一遍——否则历史越长，每个增量的重复朗读越扰人。
    const { start } = spyableNeverSettles("正在拼")
    render(<SessionShell startReply={start} />)

    send("帮我想想")

    const bubble = screen.getByText("正在拼").closest(".kk-msg")
    expect(bubble).not.toBeNull()
    expect(bubble).toHaveAttribute("aria-atomic", "true")
  })

  it("marks a failed run with an assertive alert role", () => {
    // 为什么重要：失败必须以 role=alert 主动打断播报，盲用户才能立刻得知这一轮没完成。
    render(<SessionShell startReply={failingReply} />)

    send("会失败的一轮")

    expect(screen.getByRole("alert")).toHaveTextContent("这一轮没能完成")
  })
})

describe("SessionShell markdown rendering", () => {
  it("renders assistant markdown as rich elements", () => {
    // 为什么重要：真实 LLM 输出是 markdown——助手气泡必须把 **粗体**/`代码`/列表渲染成
    // 对应元素，而不是把记号当字面文本糊在一起。
    render(
      <SessionShell
        startReply={instantReply(() => "**粗体** 和 `代码`\n\n- 一\n- 二")}
      />,
    )

    send("给点 markdown")

    expect(screen.getByText("粗体").tagName).toBe("STRONG")
    expect(screen.getByText("代码").tagName).toBe("CODE")
    expect(screen.getByText("一").closest("li")).not.toBeNull()
    expect(screen.getByText("二").closest("li")).not.toBeNull()
  })

  it("keeps user messages as plain text, not parsed markdown", () => {
    // 为什么重要：用户键入的 markdown 记号属于其原话，必须原样呈现——
    // 把用户输入也当 markdown 解析会篡改其表达，且扩大注入面。
    render(<SessionShell startReply={instantReply(() => "收到")} />)

    const input = screen.getByLabelText("对话输入")
    fireEvent.change(input, { target: { value: "**不要加粗**" } })
    fireEvent.keyDown(input, { key: "Enter" })

    const userText = inLog("**不要加粗**")
    expect(userText.tagName).toBe("P")
    // 关键：未被解析成 <strong>。
    expect(userText.querySelector("strong")).toBeNull()
  })

  it("does not render raw HTML in assistant markdown (XSS-safe)", () => {
    // 为什么重要：助手内容是半可信的；内嵌原始 HTML 绝不能变成可执行节点。
    // react-markdown 未启用 rehype-raw，<img onerror> 被当文本而非元素——本测试守住这条线。
    render(
      <SessionShell
        startReply={instantReply(
          () => "<img src=x onerror=alert(1)>\n\n安全文本",
        )}
      />,
    )

    send("注入")

    expect(screen.getByText("安全文本")).toBeInTheDocument()
    // 关键：原始 HTML 不被渲染成真实元素。
    expect(screen.getByRole("log").querySelector("img")).toBeNull()
  })
})

describe("SessionShell agent activity", () => {
  it("puts the plan above the input and the thinking inline in the chat", () => {
    // 为什么重要：这是布局的核心意图（上一版放错了）——todo 计划钉在输入框上方、
    // 不混进对话流；思考/工具等活动则像 ChatGPT/Gemini 那样内联在对话里（log 内、答案之上）。
    const withActivity: StartReply = ({
      initialState,
      onState,
      onSettled,
    }: StartReplyInput) => {
      stubCounter += 1
      const id = stubCounter
      let next = applySessionEvent(initialState, {
        kind: "todo-updated",
        eventId: `todo-${id}`,
        seq: 1,
        ...envelope,
        runId: `r-${id}`,
        todos: [
          { content: "查天气", status: "completed" },
          { content: "作答", status: "in_progress" },
        ],
      })
      next = applySessionEvent(next, {
        kind: "thinking-delta",
        eventId: `think-${id}`,
        seq: 1,
        ...envelope,
        runId: `r-${id}`,
        messageId: `m-${id}`,
        delta: "先查实时天气，再判断是否适合出门。",
      })
      next = applySessionEvent(next, {
        kind: "message-completed",
        eventId: `c-${id}`,
        seq: 1,
        ...envelope,
        runId: `r-${id}`,
        messageId: `m-${id}`,
        role: "assistant",
        content: "晴，适合出门。",
      })
      next = applySessionEvent(next, {
        kind: "run-completed",
        eventId: `done-${id}`,
        seq: 1,
        ...envelope,
        runId: `r-${id}`,
      })
      onState(next)
      onSettled?.("preview")
      return { close: () => {} }
    }
    render(<SessionShell startReply={withActivity} />)

    send("北京适合出门吗")

    const log = screen.getByRole("log")

    // 计划清单渲染，但在对话流之外（钉在输入框上方）——绝不混进 log。
    expect(screen.getByRole("list", { name: "计划" })).toBeInTheDocument()
    expect(screen.getByText("查天气")).toBeInTheDocument()
    expect(within(log).queryByRole("list", { name: "计划" })).toBeNull()

    // 过程（含思考）内联在对话流内（在 log 里、归当前轮），与答案并存。
    // 默认 Fast 模式：落定摘要按模式作「处理过程」（无工具时不带计数），不再叫「思考过程」。
    expect(within(log).getByText("处理过程")).toBeInTheDocument()
    expect(within(log).getByText("晴，适合出门。")).toBeInTheDocument()
  })

  it("groups a multi-segment run under ONE turn with steps in true emission order", () => {
    // 为什么重要：同一 run 的多段 assistant 文本属于一轮——必须收在一个 .kk-turn--assistant 下
    // （一个头像、一条脊），过程（思考/工具/子智能体）按 seq 渲染在它引出的文本之上，
    // 真实时序 thinking→tool→text→thinking→subagent→text 完整还原，绝不重排或只渲染最后一段。
    let seq = 0
    const multiSegmentReply: StartReply = ({
      initialState,
      onState,
      onSettled,
    }: StartReplyInput) => {
      stubCounter += 1
      const id = stubCounter
      const runId = `r-${id}`
      const firstMessageId = `m-${id}-1`
      const secondMessageId = `m-${id}-2`

      let next = applySessionEvent(initialState, {
        kind: "thinking-delta",
        eventId: `think-1-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: firstMessageId,
        delta: "先查天气。",
      })
      next = applySessionEvent(next, {
        kind: "tool-invoked",
        eventId: `tool-invoked-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: firstMessageId,
        toolId: `tool-${id}`,
        name: "get_weather",
        args: { city: "北京" },
      })
      next = applySessionEvent(next, {
        kind: "tool-returned",
        eventId: `tool-returned-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: firstMessageId,
        toolId: `tool-${id}`,
        name: "get_weather",
        result: "北京：晴",
      })
      next = applySessionEvent(next, {
        kind: "message-completed",
        eventId: `completed-1-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: firstMessageId,
        role: "assistant",
        content: "第一段回答：先给结论。",
      })
      next = applySessionEvent(next, {
        kind: "thinking-delta",
        eventId: `think-2-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: secondMessageId,
        delta: "再补充背景。",
      })
      next = applySessionEvent(next, {
        kind: "subagent-started",
        eventId: `subagent-started-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: secondMessageId,
        subagentId: `subagent-${id}`,
        name: "researcher",
        description: "查资料",
        subagentType: "researcher",
        source: "built-in",
      })
      next = applySessionEvent(next, {
        kind: "subagent-finished",
        eventId: `subagent-finished-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: secondMessageId,
        subagentId: `subagent-${id}`,
        name: "researcher",
        subagentType: "researcher",
        source: "built-in",
      })
      next = applySessionEvent(next, {
        kind: "message-completed",
        eventId: `completed-2-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
        messageId: secondMessageId,
        role: "assistant",
        content: "第二段回答：再补充说明。",
      })
      next = applySessionEvent(next, {
        kind: "run-completed",
        eventId: `done-${id}`,
        seq: (seq += 1),
        ...envelope,
        runId,
      })
      onState(next)
      onSettled?.("preview")
      return { close: () => {} }
    }

    render(<SessionShell startReply={multiSegmentReply} />)

    send("北京今天怎么样")

    const log = screen.getByRole("log")
    // 核心不变量：整轮收在一个 turn 下，只有一个头像。
    const turns = Array.from(log.querySelectorAll(".kk-turn--assistant"))
    expect(turns).toHaveLength(1)
    const turn = turns[0] as HTMLElement
    expect(turn.querySelectorAll(".kk-turn__avatar--bot")).toHaveLength(1)

    // 一轮内的两段文本与各自过程都在同一条脊上呈现。
    expect(within(turn).getByText("第一段回答：先给结论。")).toBeInTheDocument()
    expect(within(turn).getByText("get_weather")).toBeInTheDocument()
    expect(within(turn).getByText("第二段回答：再补充说明。")).toBeInTheDocument()
    expect(within(turn).getByText("researcher")).toBeInTheDocument()

    // 多段布局：每段 = 文本气泡在【上】＋ 它的过程（该段工具/子智能体）挂在【下面】。
    const segments = Array.from(turn.querySelectorAll(".kk-turn__segment"))
    expect(segments).toHaveLength(2)
    const seg1 = segments[0] as HTMLElement
    const seg2 = segments[1] as HTMLElement

    // 第一段：文本「先给结论」＋ 它下面挂 get_weather；该段不含 researcher。
    expect(within(seg1).getByText("第一段回答：先给结论。")).toBeInTheDocument()
    expect(within(seg1).getByText("get_weather")).toBeInTheDocument()
    expect(within(seg1).queryByText("researcher")).toBeNull()
    // 第二段：文本「再补充说明」＋ 它下面挂 researcher；该段不含 get_weather。
    expect(within(seg2).getByText("第二段回答：再补充说明。")).toBeInTheDocument()
    expect(within(seg2).getByText("researcher")).toBeInTheDocument()
    expect(within(seg2).queryByText("get_weather")).toBeNull()

    // 段内：答案气泡在过程之上。
    const bubble = seg1.querySelector(".kk-turn__answer") as HTMLElement
    const process = seg1.querySelector(".kk-process") as HTMLElement
    expect(
      bubble.compareDocumentPosition(process) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })
})

describe("SessionShell reply mode (Fast/Thinking lock)", () => {

  it("locks the mode switcher once the conversation has started", () => {
    // 为什么重要：用户硬性要求——开聊前可切 Fast/Thinking，发出首条消息后模式即锁定、不可再切。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    // 空首屏：模式可切换（出现「切换模式」触发器）。
    expect(screen.getByLabelText("切换模式")).toBeInTheDocument()

    send("开始")

    // 开聊后：切换器消失，代之以只读的锁定态（带「已锁定」无障碍名）。
    expect(screen.queryByLabelText("切换模式")).toBeNull()
    expect(screen.getByLabelText(/回应模式：.*已锁定/)).toBeInTheDocument()
  })

  it("starts a brand-new conversation unlocked again", () => {
    // 为什么重要：锁定只对当前轮；点「新对话」开新会话后应可重新选择模式。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)
    send("第一段")
    expect(screen.queryByLabelText("切换模式")).toBeNull()

    fireEvent.click(screen.getByText("新对话"))
    expect(screen.getByLabelText("切换模式")).toBeInTheDocument()
  })

  it("passes the selected mode as executionStyle when starting the first run", () => {
    const start = vi.fn(({ onSettled }: StartReplyInput) => {
      onSettled?.("preview")
      return { close: () => {} }
    })

    render(<SessionShell startReply={start} />)

    fireEvent.click(screen.getByLabelText("切换模式"))
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Thinking/ }))
    send("开始")

    expect(
      (start.mock.calls[0]?.[0] as { executionStyle?: string }).executionStyle,
    ).toBe("thinking")
  })
})

describe("SessionShell sessions list", () => {
  it("lists conversations in the rail and switches between them", () => {
    // 为什么重要：多会话的核心——发起两段对话后，左侧能列出并自由切换，
    // 切回某段时它的消息原样回来，互不串话。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("第一段")
    expect(inLog("第一段")).toBeInTheDocument()

    fireEvent.click(screen.getByText("新对话"))
    send("第二段")
    expect(inLog("第二段")).toBeInTheDocument()

    // rail 历史列表同时列出两段（标题=各自首条消息）。
    const list = screen.getByRole("navigation", { name: "历史会话" })
    expect(within(list).getByText("第一段")).toBeInTheDocument()
    expect(within(list).getByText("第二段")).toBeInTheDocument()

    // 切回第一段：它的消息回来，第二段不在当前对话区。
    fireEvent.click(within(list).getByText("第一段"))
    expect(inLog("第一段")).toBeInTheDocument()
    expect(within(screen.getByRole("log")).queryByText("第二段")).toBeNull()
  })

  it("deletes a conversation from the rail", () => {
    // 为什么重要：列表必须可删；删掉唯一一段会回到干净的空首屏。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("待删除")
    const list = screen.getByRole("navigation", { name: "历史会话" })
    expect(within(list).getByText("待删除")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("删除会话 待删除"))

    // 删掉唯一会话 → 起一个新的空会话：hero 回归，旧标题消失。
    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
    expect(screen.queryByText("待删除")).toBeNull()
  })
})

describe("SessionShell interrupt recovery", () => {
  it("re-attaches to an in-flight run persisted across a reload", () => {
    // 为什么重要：刷新/断线时后端仍在跑这一轮、事件进 replay 流；web 重订阅即续传。
    // 用带 pendingInput 的持久会话模拟「刷新时仍在途」，注入同步重连桩补完终态。
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: "c1",
        conversations: [
          {
            id: "c1",
            title: "未完成的一问",
            updatedAt: 1,
            pendingInput: "未完成的一问",
            thread: {
              seenEventIds: ["d1"],
              messages: [
                { id: "u1", role: "user", content: "未完成的一问" },
                { id: "a1", role: "assistant", content: "已经生成了一半" },
              ],
              runStatus: "idle",
            },
          },
        ],
      }),
    )

    const reattachCalls: string[] = []
    const reattach: ReattachReply = ({
      sessionId,
      initialState,
      onState,
      onSettled,
    }) => {
      reattachCalls.push(sessionId)
      const done = applySessionEvent(
        applySessionEvent(initialState, {
          kind: "message-completed",
          eventId: "re-c",
          seq: 1,
          ...envelope,
          runId: "r-re",
          messageId: "a1",
          role: "assistant",
          content: "续传后补完的完整回答",
        }),
        { kind: "run-completed", eventId: "re-d", seq: 1, ...envelope, runId: "r-re" },
      )
      onState(done)
      onSettled()
      return { close: () => {} }
    }

    render(
      <SessionShell startReply={instantReply((input) => input)} reattach={reattach} />,
    )

    // 重订阅了这一会话自己的 SSE（sessionId = 会话 id）。
    expect(reattachCalls).toEqual(["c1"])
    // 续传把半截回答补完，并退出流式态。
    expect(inLog("续传后补完的完整回答")).toBeInTheDocument()
    expect(screen.getByLabelText("对话输入")).not.toBeDisabled()
  })

  it("surfaces a distinct 重连中 anchor while reattaching (before any event)", () => {
    // 为什么重要：重连续传与「正在思考」不能长一个样——重连必须有自己可辨识的锚点（文案/样式），
    // 让用户知道是在「重新接上这一轮」，而非「正在新想」。这里 reattach 永不回事件，停在重连态。
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: "c1",
        conversations: [
          {
            id: "c1",
            title: "重连中的一问",
            updatedAt: 1,
            pendingInput: "重连中的一问",
            thread: {
              seenEventIds: [],
              messages: [{ id: "u1", role: "user", content: "重连中的一问" }],
              runStatus: "idle",
            },
          },
        ],
      }),
    )

    // 永不回任何事件、也不 settle：组件停留在「重连中」态。
    const reattach: ReattachReply = () => ({ close: () => {} })

    const { container } = render(
      <SessionShell startReply={instantReply((input) => input)} reattach={reattach} />,
    )

    // 重连锚点在对话流内、文案为「重连中…」，与「正在思考…」明确区分（rail 标题同名词在 log 外）。
    const log = screen.getByRole("log")
    expect(within(log).getByText("重连中…")).toBeInTheDocument()
    expect(within(log).queryByText("正在思考")).toBeNull()
    expect(within(log).queryByText("正在整理回答")).toBeNull()
    // 用 data 钩子让 CSS 给重连锚点独立样式（区别于普通成形脉冲）。
    expect(container.querySelector('[data-anchor="reconnecting"]')).not.toBeNull()
  })

  it("does not re-attach a conversation with no in-flight run", () => {
    // 为什么重要：没有 pendingInput 的（已完成/全新）会话刷新后不得误触发重连。
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        activeId: "c1",
        conversations: [
          {
            id: "c1",
            title: "已完成",
            updatedAt: 1,
            thread: {
              seenEventIds: [],
              messages: [{ id: "u1", role: "user", content: "已完成" }],
              runStatus: "completed",
            },
          },
        ],
      }),
    )

    const reattachCalls: string[] = []
    const reattach: ReattachReply = ({ sessionId }) => {
      reattachCalls.push(sessionId)
      return { close: () => {} }
    }

    render(
      <SessionShell startReply={instantReply((input) => input)} reattach={reattach} />,
    )

    expect(reattachCalls).toEqual([])
  })
})
