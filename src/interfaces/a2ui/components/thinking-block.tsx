import { z } from "zod"
import { createComponentImplementation } from "@a2ui/react/v0_9"
import { DynamicStringSchema } from "@a2ui/web_core/v0_9"

const thinkingSchema = z.object({
  // DynamicString: accepts { path: "..." } in JSON, resolves to string at runtime
  summary: DynamicStringSchema,
})

// 可折叠思考块（对标原型 .thinking）；默认折叠。
function ThinkingRender({ props }: { props: z.infer<typeof thinkingSchema> & { summary: string } }) {
  return (
    <details className="kk-thinking">
      <summary className="kk-thinking__summary">💭 思考</summary>
      <p className="kk-thinking__body">{props.summary}</p>
    </details>
  )
}

export const thinkingBlockComponent = createComponentImplementation(
  { name: "ThinkingBlock", schema: thinkingSchema },
  ThinkingRender,
)
