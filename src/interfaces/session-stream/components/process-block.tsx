import { type ReactEventHandler, useState } from "react"

import type { AgentMode } from "@/application/conversation-store"
import type {
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream-reducer"

import { ChevronIcon, SparkIcon } from "./icons"
import { SubagentRow } from "./subagent-row"
import { ToolCallRow } from "./tool-call-row"

type ProcessBlockProps = {
  thinking: string
  toolCalls: SessionToolCall[]
  subagents: SessionSubagent[]
  // 这一轮是否仍在流式：决定默认展开（实时看）与「思考中」脉冲。
  live: boolean
  // 本会话模式：仅作 data-mode 钩子，密度差异交给 CSS（Thinking 略松、Fast 略紧）。
  mode?: AgentMode
}

// 助手这一轮的「过程」：思考 + 工具 + 子智能体，收成一个可折叠披露项。
// 流式时默认展开方便实时看，落定后由父级换 key 重挂载、收成一行摘要（保持对话干净）。
// 全空时不渲染。
export function ProcessBlock({
  thinking,
  toolCalls,
  subagents,
  live,
  mode,
}: ProcessBlockProps) {
  // 受控开合：初始随 live；用户可手动展开/收起，onToggle 回写。父级用 key 在流式状态翻转时重置。
  const [open, setOpen] = useState(live)

  const hasActivity =
    thinking.length > 0 || toolCalls.length > 0 || subagents.length > 0
  if (!hasActivity) {
    return null
  }

  const handleToggle: ReactEventHandler<HTMLDetailsElement> = (event) => {
    setOpen(event.currentTarget.open)
  }

  const summary = live
    ? "思考中…"
    : toolCalls.length > 0
      ? `思考过程 · ${toolCalls.length} 个工具`
      : "思考过程"

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
          <span className="kk-process__live" aria-label="思考中">
            <i />
            <i />
            <i />
          </span>
        ) : null}
        <ChevronIcon className="kk-process__chevron" />
      </summary>

      <div className="kk-process__body">
        {thinking ? <p className="kk-process__thinking">{thinking}</p> : null}

        {toolCalls.length > 0 ? (
          <div className="kk-actgroup" aria-label="工具调用">
            {toolCalls.map((tool) => (
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
