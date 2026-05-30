/**
 * Plan component — CC/Gemini-style todo checklist.
 *
 * Session emits: { id, component: "Plan", todosPath: { path: "/plans/{plan_id}" } }
 * with updateDataModel at that path = Array<{ content: string, status: "pending" | "in_progress" | "completed" }>.
 *
 * Binding resolution: todosPath is declared as DynamicValueSchema (a union containing { path }).
 * GenericBinder detects it as DYNAMIC and resolves the { path } binding to the actual array at
 * that data-model path. So props.todosPath is the live array of todo items.
 */
import type React from "react"
import { z } from "zod"
import { createComponentImplementation } from "@a2ui/react/v0_9"
import type { ReactA2uiComponentProps } from "@a2ui/react/v0_9"
import { DynamicValueSchema } from "@a2ui/web_core/v0_9"
import type { ResolveA2uiProps } from "@a2ui/web_core/v0_9"

const planSchema = z.object({
  // todosPath binds to an array in the data model via { path: "..." }.
  // DynamicValueSchema is a union containing { path }, so GenericBinder classifies
  // this field as DYNAMIC and resolves it to the data at that path (the todos array).
  todosPath: DynamicValueSchema,
})

type PlanProps = ResolveA2uiProps<z.infer<typeof planSchema>>
type TodoItem = { content: string; status: "pending" | "in_progress" | "completed" }

const MARK: Record<string, string> = {
  pending: "○",
  in_progress: "◐",
  completed: "✓",
}

// CC/Gemini style todo checklist; renders the resolved todos array from todosPath.
// props.todosPath resolves at runtime to the actual array bound at the data-model path.
function PlanRender({ props }: ReactA2uiComponentProps<PlanProps>) {
  const todos = Array.isArray(props.todosPath) ? (props.todosPath as TodoItem[]) : []
  return (
    <div className="kk-plan">
      <p className="kk-plan__title">📋 计划</p>
      <ul className="kk-plan__list">
        {todos.map((t, i) => (
          <li key={i} className="kk-todo" data-testid="kk-todo" data-status={t.status}>
            <span className="kk-todo__mark">{MARK[t.status] ?? "○"}</span>
            <span className="kk-todo__text">{t.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export const planComponent = createComponentImplementation(
  { name: "Plan", schema: planSchema },
  PlanRender as React.FC<ReactA2uiComponentProps<PlanProps>>,
)
