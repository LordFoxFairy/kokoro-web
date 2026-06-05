import { useState } from "react"

import type {
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream-reducer"
import type { SessionTodo } from "@/domain/shared/session-stream-event"

import { ChevronIcon } from "./icons"

type ActivityPanelProps = {
  thinking: string
  todos: SessionTodo[]
  toolCalls: SessionToolCall[]
  subagents: SessionSubagent[]
}

const TODO_MARK: Record<SessionTodo["status"], string> = {
  completed: "✓",
  in_progress: "◐",
  pending: "○",
}

// 智能体活动：浮动、可折叠的卡片，钉在对话区一角，不随消息滚走，方便实时盯进度。
// 内容：CC 风格 todo 清单 + 工具调用 + 子智能体 + 思考。全空时不渲染。
export function ActivityPanel({
  thinking,
  todos,
  toolCalls,
  subagents,
}: ActivityPanelProps) {
  const [collapsed, setCollapsed] = useState(false)

  const hasActivity =
    thinking.length > 0 ||
    todos.length > 0 ||
    toolCalls.length > 0 ||
    subagents.length > 0
  if (!hasActivity) {
    return null
  }

  const doneCount = todos.filter((todo) => todo.status === "completed").length
  const summary =
    todos.length > 0
      ? `计划 ${doneCount}/${todos.length}`
      : toolCalls.length > 0
        ? `工具 ${toolCalls.length}`
        : "进行中"

  return (
    <section
      className="kk-activity"
      aria-label="智能体活动"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <button
        className="kk-activity__toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-expanded={!collapsed}
      >
        <span className="kk-activity__toggle-title">智能体活动 · {summary}</span>
        <ChevronIcon className="kk-activity__chevron" />
      </button>

      {collapsed ? null : (
        <div className="kk-activity__body">
          {thinking ? (
            <details className="kk-activity__thinking">
              <summary>思考过程</summary>
              <p>{thinking}</p>
            </details>
          ) : null}

          {todos.length > 0 ? (
            <div className="kk-activity__group" role="list" aria-label="计划">
              <p className="kk-activity__label">计划</p>
              {todos.map((todo, index) => (
                <div
                  key={`${index}-${todo.content}`}
                  className={`kk-todo kk-todo--${todo.status}`}
                  role="listitem"
                >
                  <span className="kk-todo__mark" aria-hidden>
                    {TODO_MARK[todo.status]}
                  </span>
                  <span className="kk-todo__text">{todo.content}</span>
                </div>
              ))}
            </div>
          ) : null}

          {toolCalls.length > 0 ? (
            <div className="kk-activity__group" aria-label="工具调用">
              {toolCalls.map((tool) => (
                <div key={tool.id} className={`kk-tool kk-tool--${tool.status}`}>
                  <span className="kk-tool__name">🔧 {tool.name}</span>
                  <span className="kk-tool__state" aria-hidden>
                    {tool.status === "done" ? "✓" : "…"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          {subagents.length > 0 ? (
            <div className="kk-activity__group" aria-label="子智能体">
              {subagents.map((subagent) => (
                <div key={subagent.id} className="kk-subagent">
                  <span className="kk-subagent__name">🤖 {subagent.name}</span>
                  <span className="kk-subagent__state" aria-hidden>
                    {subagent.status === "done" ? "✓" : "…"}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}
