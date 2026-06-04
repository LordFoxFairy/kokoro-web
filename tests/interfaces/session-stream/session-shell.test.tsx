import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  StartReply,
  StartReplyInput,
} from "@/application/session-stream-preview"
import { applySessionEvent } from "@/application/session-stream-reducer"
import { SessionShell } from "@/interfaces/session-stream/session-shell"

afterEach(() => {
  cleanup()
  // jsdom 的 localStorage 在用例间是共享的，必须清掉以隔离持久化断言。
  window.localStorage.clear()
})

const STORAGE_KEY = "kokoro:session-thread"

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
      ...envelope,
      runId: `stub-run-${id}`,
      messageId: `stub-msg-${id}`,
      role: "assistant",
      content: makeText(input),
    })
    const done = applySessionEvent(completed, {
      kind: "run-completed",
      eventId: `stub-done-${id}`,
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
          ...envelope,
          runId: `fts-run-${id}`,
          errorKind: "agent_error",
          message: "boom",
        })
      : applySessionEvent(
          applySessionEvent(initialState, {
            kind: "message-completed",
            eventId: `fts-c-${id}`,
            ...envelope,
            runId: `fts-run-${id}`,
            messageId: `fts-msg-${id}`,
            role: "assistant",
            content: `恢复：${input}`,
          }),
          {
            kind: "run-completed",
            eventId: `fts-done-${id}`,
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
})

describe("SessionShell starter chips", () => {
  it("offers starter template chips on the empty hero", () => {
    // 为什么重要：空首屏给出创作模板入口，降低“从零打字”的启动成本（对齐原型 chip 行）。
    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(screen.getByRole("group", { name: "创作模板" })).toBeInTheDocument()
    expect(screen.getByText("小红书风海报")).toBeInTheDocument()
    expect(screen.getByText("学习课件")).toBeInTheDocument()
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

    expect(screen.getByText("帮我理理今天")).toBeInTheDocument()
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

    expect(screen.getByText("在吗")).toBeInTheDocument()
    // 文案从静态省略号改为「正在输入」+ CSS 脉冲；省略号语义交给动画三点承担。
    expect(screen.getByText("正在输入")).toBeInTheDocument()
    expect(screen.getByLabelText("对话输入")).toBeDisabled()
  })

  it("accumulates earlier turns across a second exchange", () => {
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("第一句")
    send("第二句")

    // 两轮的用户与 assistant 消息都必须保留，时间线不能被新一轮清空。
    expect(screen.getByText("第一句")).toBeInTheDocument()
    expect(screen.getByText("答：第一句")).toBeInTheDocument()
    expect(screen.getByText("第二句")).toBeInTheDocument()
    expect(screen.getByText("答：第二句")).toBeInTheDocument()
  })

  it("surfaces an inline error and re-enables the input on a failed run", () => {
    render(<SessionShell startReply={failingReply} />)

    send("会失败的一轮")

    expect(screen.getByText("会失败的一轮")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("这一轮没能完成")
    // 失败后输入框恢复可用，用户可以重试。
    expect(screen.getByLabelText("对话输入")).not.toBeDisabled()
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

  it("shows the streaming indicator only while streaming", () => {
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    // instantReply 同步 settle：渲染后绝不应残留流式指示。
    send("已结束")
    expect(screen.queryByText("正在输入")).not.toBeInTheDocument()
  })

  it("clears the streaming indicator after a stop", () => {
    const { start } = spyableNeverSettles("半句")
    render(<SessionShell startReply={start} />)

    send("说点什么")
    expect(screen.getByText("正在输入")).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText("停止生成"))
    expect(screen.queryByText("正在输入")).not.toBeInTheDocument()
  })
})

describe("SessionShell new conversation reset", () => {
  it("clears a completed exchange back to the empty hero on 新对话", () => {
    // 为什么重要：新对话必须真正把会话线归零回首屏，而不是只清输入框，
    // 否则旧的气泡会污染新一段对话的上下文与视觉。
    render(<SessionShell startReply={instantReply((input) => `答：${input}`)} />)

    send("第一段对话")
    expect(screen.getByText("第一段对话")).toBeInTheDocument()
    expect(screen.getByText("答：第一段对话")).toBeInTheDocument()

    fireEvent.click(screen.getByText("新对话"))

    // 气泡全部消失、hero 回归、输入框清空且可用。
    expect(screen.queryByText("第一段对话")).not.toBeInTheDocument()
    expect(screen.queryByText("答：第一段对话")).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "今天想做什么？" }),
    ).toBeInTheDocument()
    const input = screen.getByLabelText("对话输入")
    expect(input).toHaveValue("")
    expect(input).not.toBeDisabled()
    // 焦点回到输入框，用户无需再点一次就能直接开始下一段。
    expect(input).toHaveFocus()
    // 重置也要落盘为空：刷新后不应又冒出刚清掉的旧对话。
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) as string,
    )
    expect(persisted.messages).toEqual([])
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
        seenEventIds: ["evt_done"],
        messages: [
          { id: "u1", role: "user", content: "持久化的问题" },
          { id: "a1", role: "assistant", content: "持久化的回答" },
        ],
        runStatus: "completed",
      }),
    )

    render(<SessionShell startReply={instantReply((input) => input)} />)

    expect(screen.getByText("持久化的问题")).toBeInTheDocument()
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
    const contents = (persisted.messages as { content: string }[]).map(
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
    // 用户气泡未被重复追加：仍只有一条。
    expect(screen.getAllByText("会先失败再成功")).toHaveLength(1)
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
