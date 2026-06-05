import { useState } from "react"

import type { SessionTodo } from "@/domain/shared/session-stream-event"

import {
  CheckCircleIcon,
  ChecklistIcon,
  ChevronIcon,
  CircleIcon,
  DotCircleIcon,
} from "./icons"

type TodoBarProps = {
  todos: SessionTodo[]
}

// 每个 todo 状态对应的细线状态图标（CC 风格：完成 / 进行中 / 待办）。
function todoIcon(status: SessionTodo["status"]) {
  if (status === "completed") {
    return <CheckCircleIcon className="kk-todo__glyph" />
  }
  if (status === "in_progress") {
    return <DotCircleIcon className="kk-todo__glyph" />
  }
  return <CircleIcon className="kk-todo__glyph" />
}

// 计划条：钉在输入框上方的可收缩 CC 风格清单。常驻可查、不随对话滚走。
// 无 todo 时不渲染（不在输入框上方留空壳）。
export function TodoBar({ todos }: TodoBarProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (todos.length === 0) {
    return null
  }

  const doneCount = todos.filter((todo) => todo.status === "completed").length

  return (
    <section
      className="kk-todobar"
      aria-label="计划"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <button
        className="kk-todobar__toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="kk-todobar__title">
          <ChecklistIcon className="kk-todobar__title-icon" />
          <span>计划</span>
          <span className="kk-todobar__count">
            {doneCount}/{todos.length}
          </span>
        </span>
        <ChevronIcon className="kk-todobar__chevron" />
      </button>

      {collapsed ? null : (
        <div className="kk-todobar__list" role="list" aria-label="计划">
          {todos.map((todo, index) => (
            <div
              key={`${index}-${todo.content}`}
              className={`kk-todo kk-todo--${todo.status}`}
              role="listitem"
            >
              <span className="kk-todo__mark" aria-hidden>
                {todoIcon(todo.status)}
              </span>
              <span className="kk-todo__text">{todo.content}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
