import type { AgentMode } from "@/application/conversation-store"
import type {
  SegmentActivity,
  SessionMessage,
} from "@/application/session-stream-reducer"

import { RobotIcon } from "./icons"
import { MarkdownMessage } from "./markdown-message"
import { ProcessBlock } from "./process-block"

type AssistantTurnProps = {
  // 这一段 assistant 文本；流式过程先到、正文未到时可能暂缺。
  message?: SessionMessage
  // 这一个 messageId 自己的过程（思考/工具/子智能体），就近挂在该段气泡下。
  activity?: SegmentActivity
  isStreamingAssistant: boolean
  isStreaming: boolean
  // 本会话模式：透传给过程块作密度差异钩子。
  mode?: AgentMode
}

// 助手一段：一个🤖头像 + 一段回答 + 这一段自己的过程。
// 多段回答时，每段各自成块，工具/子智能体不跨段串挂。
export function AssistantTurn({
  message,
  activity,
  isStreamingAssistant,
  isStreaming,
  mode,
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
        {message ? (
          <div className="kk-msg__bubble">
            <MarkdownMessage content={message.content} />
            {/* 正在出字的就近线索：紧跟正文的内联闪烁光标，对读屏隐藏；落定即消失。 */}
            {isStreamingAssistant && message.content ? (
              <span className="kk-caret" aria-hidden />
            ) : null}
          </div>
        ) : null}
        <ProcessBlock
          key={isStreaming ? "live" : "settled"}
          thinking={activity?.thinking ?? ""}
          toolCalls={activity?.toolCalls ?? []}
          subagents={activity?.subagents ?? []}
          live={isStreaming}
          mode={mode}
        />
      </div>
    </article>
  )
}
