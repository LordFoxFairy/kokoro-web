import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

import type { SessionTodo } from "@/domain/session-stream-event"
import { TodoBar } from "@/interfaces/session-stream/components/todo-bar"

afterEach(cleanup)

describe("TodoBar", () => {
  it("renders nothing when there are no todos", () => {
    // 为什么重要：没有计划时输入框上方不能留一个空壳条，挤占对话空间。
    const { container } = render(<TodoBar todos={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it("shows the CC-style plan with per-status items and a progress count", () => {
    // 为什么重要：计划条是常驻可查的当轮规划，三种状态都要可见，计数反映完成度。
    const todos: SessionTodo[] = [
      { content: "查天气", status: "completed" },
      { content: "作答", status: "in_progress" },
      { content: "复核", status: "pending" },
    ]
    render(<TodoBar todos={todos} />)

    const plan = screen.getByRole("list", { name: "计划" })
    expect(within(plan).getByText("查天气")).toBeInTheDocument()
    expect(within(plan).getByText("作答")).toBeInTheDocument()
    expect(within(plan).getByText("复核")).toBeInTheDocument()
    expect(screen.getByText("1/3")).toBeInTheDocument()
  })

  it("collapses the list while keeping the header so it can be reopened", () => {
    // 为什么重要：用户要能收缩计划条腾出空间，但收缩后仍要留标题以便随时展开。
    const todos: SessionTodo[] = [{ content: "查天气", status: "pending" }]
    render(<TodoBar todos={todos} />)

    expect(screen.getByText("查天气")).toBeInTheDocument()

    // 收起：列表消失，但标题（计划）仍在，可再次展开。
    fireEvent.click(screen.getByRole("button", { expanded: true }))
    expect(screen.queryByText("查天气")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { expanded: false })).toBeInTheDocument()
  })
})
