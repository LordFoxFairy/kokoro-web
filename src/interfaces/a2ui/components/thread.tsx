import { z } from "zod"
import { createComponentImplementation } from "@a2ui/react/v0_9"
import { ChildListSchema } from "@a2ui/web_core/v0_9"
import type { ReactA2uiComponentProps } from "@a2ui/react/v0_9"
import type { ResolveA2uiProps } from "@a2ui/web_core/v0_9"
import type React from "react"

const threadSchema = z.object({ children: ChildListSchema })
type ThreadProps = ResolveA2uiProps<z.infer<typeof threadSchema>>

// 对话滚动容器：按 children 顺序竖排（对标原型 .chat-thread）。
// buildChild(id) renders the child component by id into a ReactNode.
function ThreadRender({ props, buildChild }: ReactA2uiComponentProps<ThreadProps>) {
  const children = Array.isArray(props.children) ? props.children : []
  return (
    <div className="kk-thread" data-testid="kk-thread">
      {children.map((child) => {
        const id = typeof child === "string" ? child : (child as { id: string }).id
        const basePath = typeof child === "string" ? undefined : (child as { basePath?: string }).basePath
        return (
          <div key={id} className="kk-thread__item">
            {buildChild(id, basePath)}
          </div>
        )
      })}
    </div>
  )
}

export const threadComponent = createComponentImplementation(
  { name: "Thread", schema: threadSchema },
  // Cast needed: TS can't unify the parameterized vs resolved `children` form —
  // ChildList erases to `any` after ResolveA2uiProps, so the FC signature widens.
  ThreadRender as React.FC<ReactA2uiComponentProps<ThreadProps>>,
)
