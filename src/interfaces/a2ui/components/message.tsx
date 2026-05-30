/**
 * LOCKED @a2ui signature pattern (discovered via .d.ts + implementation):
 *   createComponentImplementation(api, RenderComponent)
 *   RenderComponent: FC<{ props: ResolvedProps, buildChild: (id, basePath?) => ReactNode, context: ComponentContext }>
 *   - Dynamic fields (DynamicStringSchema): props.text resolved to string by GenericBinder
 *   - Static fields (z.string()): props.author is plain string
 *   - Structural fields (ChildListSchema): props.children resolved to { id, basePath }[] by GenericBinder
 */
import { z } from "zod"
import { createComponentImplementation } from "@a2ui/react/v0_9"
import { DynamicStringSchema } from "@a2ui/web_core/v0_9"

const messageSchema = z.object({
  author: z.enum(["ai", "user"]),
  // DynamicString: accepts { path: "..." } in JSON, resolves to string at runtime
  text: DynamicStringSchema,
})

// AI 左对齐无气泡叙述流；user 右对齐气泡（ADR-008）。
function MessageRender({ props }: { props: z.infer<typeof messageSchema> & { text: string } }) {
  const isAi = props.author === "ai"
  return (
    <div className={isAi ? "kk-msg kk-msg--ai" : "kk-msg kk-msg--user"}>
      <p className="kk-msg__text">{props.text}</p>
    </div>
  )
}

export const messageComponent = createComponentImplementation(
  { name: "Message", schema: messageSchema },
  MessageRender,
)
