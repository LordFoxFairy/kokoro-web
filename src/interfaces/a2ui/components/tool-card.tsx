import { z } from "zod"
import { createComponentImplementation } from "@a2ui/react/v0_9"

const toolSchema = z.object({ toolName: z.string(), status: z.string() })

// 工具卡（对标原型 .tool-call-details）：running 呼吸，done/ok ✓，error ⚠️。
function ToolRender({ props }: { props: z.infer<typeof toolSchema> }) {
  const mark = props.status === "running" ? "⟳" : props.status === "error" ? "⚠️" : "✓"
  return (
    <div className="kk-tool" data-testid="kk-tool" data-status={props.status}>
      <span className="kk-tool__icon">🔧</span>
      <span className="kk-tool__name">{props.toolName}</span>
      <span className="kk-tool__mark">{mark}</span>
    </div>
  )
}

export const toolCardComponent = createComponentImplementation(
  { name: "ToolCard", schema: toolSchema },
  ToolRender,
)
