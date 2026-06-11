import { type ReactEventHandler, useState } from "react"

import type { AgentMode } from "@/application/conversation-store"
import type {
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream/reducer"

import { ChevronIcon, SparkIcon } from "./icons"
import { SubagentRow } from "./subagent-row"
import { ToolCallRow } from "./tool-call-row"

type SegmentProcessProps = {
  // 这一段的过程：思考独白 + 该段用到的工具 + 子智能体。
  thinking: string
  tools: SessionToolCall[]
  subagents: SessionSubagent[]
  // 这一段是否仍在生长（整轮的尾段）：决定默认展开（实时看）与「思考中」脉冲。
  live: boolean
  // 本会话模式：Fast 把「思考」改称「处理」，避免「直接作答」与「思考」自相矛盾。
  mode?: AgentMode
}

// 落定摘要：「思考过程 · N 工具 · M 子智能体」，省略为零的维度。
function settledSummary(verb: string, tools: number, subs: number): string {
  const parts = [`${verb}过程`]
  if (tools > 0) parts.push(`${tools} 个工具`)
  if (subs > 0) parts.push(`${subs} 个子智能体`)
  return parts.join(" · ")
}

// 一段的「过程块」：挂在该段答案气泡【下面】的可折叠次级披露——比气泡更轻（muted）。
// 流式中（尾段）默认展开方便实时看，落定后收成一行摘要，保持对话干净。全空时不渲染。
export function SegmentProcess({
  thinking,
  tools,
  subagents,
  live,
  mode,
}: SegmentProcessProps) {
  // 默认展开态跟随 live 信号：尾段流式时摊开实时看，落定即收成一行摘要。
  // 一旦用户手动切换（manualOpen 落定），就以用户意图为准、不再随 live 变化对抗用户。
  // 不靠 remount/翻 key——保留 details 自身的滚动与状态，仅在未被接管时让默认值随 live 流动。
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const open = manualOpen ?? live

  const hasActivity =
    thinking.length > 0 || tools.length > 0 || subagents.length > 0
  if (!hasActivity) {
    return null
  }

  const handleToggle: ReactEventHandler<HTMLDetailsElement> = (event) => {
    // 仅当用户真正改变了展开态（结果 ≠ 本帧受控下发的 open）才记为手动接管；
    // React 因 live 翻转同步 open 而触发的 toggle 与 open 一致，忽略，避免冻结住跟随。
    if (event.currentTarget.open !== open) {
      setManualOpen(event.currentTarget.open)
    }
  }

  const verb = mode === "fast" ? "处理" : "思考"
  const summary = live
    ? `${verb}中…`
    : settledSummary(verb, tools.length, subagents.length)

  return (
    <details
      className="kk-process"
      data-mode={mode}
      open={open}
      onToggle={handleToggle}
    >
      <summary className="kk-process__summary">
        <SparkIcon className="kk-process__spark" />
        <span className="kk-process__title">{summary}</span>
        {live ? (
          <span className="kk-process__live" aria-label={`${verb}中`}>
            <i />
            <i />
            <i />
          </span>
        ) : null}
        <ChevronIcon className="kk-process__chevron" />
      </summary>

      <div className="kk-process__body">
        {thinking ? <p className="kk-process__thinking">{thinking}</p> : null}

        {tools.length > 0 ? (
          <div className="kk-actgroup" aria-label="工具调用">
            {tools.map((tool) => (
              <ToolCallRow key={tool.id} tool={tool} />
            ))}
          </div>
        ) : null}

        {subagents.length > 0 ? (
          <div className="kk-actgroup" aria-label="子智能体">
            {subagents.map((subagent) => (
              <SubagentRow key={subagent.id} subagent={subagent} />
            ))}
          </div>
        ) : null}
      </div>
    </details>
  )
}
