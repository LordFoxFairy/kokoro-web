import type {
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream-reducer"
import type { SessionTodo } from "@/domain/shared/session-stream-event"

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

// 智能体活动：CC 风格 todo 清单 + 工具调用 + 子智能体 + 思考（可折叠）。
// 由 reducer 累积的活动状态驱动；全空时不渲染，避免空首屏出现噪声块。
export function ActivityPanel({
  thinking,
  todos,
  toolCalls,
  subagents,
}: ActivityPanelProps) {
  const hasActivity =
    thinking.length > 0 ||
    todos.length > 0 ||
    toolCalls.length > 0 ||
    subagents.length > 0
  if (!hasActivity) {
    return null
  }

  return (
    <section className="kk-activity" aria-label="智能体活动">
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
    </section>
  )
}
