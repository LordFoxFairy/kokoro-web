import { useState } from "react"

import type { SessionTodo } from "@/core/state"
import {
  CheckCircleIcon,
  ChecklistIcon,
  ChevronIcon,
  CircleIcon,
  DotCircleIcon,
} from "@/ui/icons/thread"

import styles from "./todo-bar.module.css"

type TodoBarProps = {
  todos: SessionTodo[]
}

// 每个 todo 状态对应的细线状态图标（完成 / 进行中 / 待办）。
function todoIcon(status: SessionTodo["status"]) {
  if (status === "completed") {
    return <CheckCircleIcon className={styles.todoGlyph} />
  }
  if (status === "in_progress") {
    return <DotCircleIcon className={styles.todoGlyph} />
  }
  return <CircleIcon className={styles.todoGlyph} />
}

// 计划条：钉在输入框上方的可收缩清单。常驻可查、不随对话滚走。
// 无 todo 时不渲染（不在输入框上方留空壳）。
export function TodoBar({ todos }: TodoBarProps) {
  const [collapsed, setCollapsed] = useState(false)

  if (todos.length === 0) {
    return null
  }

  const doneCount = todos.filter((todo) => todo.status === "completed").length

  return (
    <section
      className={styles.todobar}
      aria-label="计划"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <button
        className={styles.toggle}
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className={styles.title}>
          <ChecklistIcon className={styles.titleIcon} />
          <span>计划</span>
          <span className={styles.count}>
            {doneCount}/{todos.length}
          </span>
        </span>
        <ChevronIcon className={styles.chevron} />
      </button>

      {collapsed ? null : (
        <div className={styles.list} role="list" aria-label="计划">
          {todos.map((todo, index) => (
            <div
              key={`${index}-${todo.content}`}
              className={styles.todo}
              data-status={todo.status}
              role="listitem"
            >
              <span className={styles.mark} aria-hidden>
                {todoIcon(todo.status)}
              </span>
              <span className={styles.text}>{todo.content}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
