import type {
  SessionMessage,
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream-reducer"

import { RobotIcon } from "./icons"
import { MarkdownMessage } from "./markdown-message"
import { ProcessBlock } from "./process-block"

type AssistantTurnProps = {
  // 这一轮的最终回答（流式且尚未产出首块文本时可能缺席）。
  message?: SessionMessage
  isStreamingAssistant: boolean
  // 这一轮的过程（思考/工具/子智能体）+ 是否仍在流式。
  thinking: string
  toolCalls: SessionToolCall[]
  subagents: SessionSubagent[]
  isStreaming: boolean
}

// 助手这一轮：一个🤖头像 → 可折叠「过程」→ 回答气泡，统统归在同一头像下，
// 让活动明确属于当前这轮回答（对齐 ChatGPT/Claude 的网页对话布局）。
export function AssistantTurn({
  message,
  isStreamingAssistant,
  thinking,
  toolCalls,
  subagents,
  isStreaming,
}: AssistantTurnProps) {
  return (
    <article
      className="kk-msg kk-msg--assistant"
      aria-atomic={isStreamingAssistant ? true : undefined}
    >
      <div className="kk-msg__avatar kk-msg__avatar--bot" aria-hidden>
        <RobotIcon />
      </div>
      <div className="kk-turn__stack">
        {/* 回答在上（最醒目），过程折叠在下（how-I-got-here，Perplexity 式答案优先）。 */}
        {message ? (
          <div className="kk-msg__bubble">
            <MarkdownMessage content={message.content} />
          </div>
        ) : null}
        {/* key 随流式状态翻转：落定时重挂载，把「过程」从展开重置为收起的一行摘要。 */}
        <ProcessBlock
          key={isStreaming ? "live" : "settled"}
          thinking={thinking}
          toolCalls={toolCalls}
          subagents={subagents}
          live={isStreaming}
        />
      </div>
    </article>
  )
}
