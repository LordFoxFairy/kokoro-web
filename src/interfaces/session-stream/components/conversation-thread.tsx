import type { RefObject, UIEvent } from "react"

import type {
  SessionMessage,
  SessionSubagent,
  SessionToolCall,
} from "@/application/session-stream-reducer"

import { AssistantTurn } from "./assistant-turn"
import { MessageBubble } from "./message-bubble"

type ConversationThreadProps = {
  messages: SessionMessage[]
  isStreaming: boolean
  hasFailed: boolean
  onRetry: () => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  threadEndRef: RefObject<HTMLDivElement | null>
  // 当轮活动：思考/工具/子智能体，归入当前这轮的助手分组（头像下、回答之上）。
  thinking: string
  toolCalls: SessionToolCall[]
  subagents: SessionSubagent[]
}

export function ConversationThread({
  messages,
  isStreaming,
  hasFailed,
  onRetry,
  onScroll,
  threadEndRef,
  thinking,
  toolCalls,
  subagents,
}: ConversationThreadProps) {
  // 当前这轮 = 最后一条用户消息之后的内容。它的助手回答与过程归为一个分组（共用一个头像）。
  // 之前的历史消息照常逐条渲染；过程只属于当前轮（活动状态每轮重置）。
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index
      break
    }
  }

  const head = messages.slice(0, lastUserIndex + 1)
  const tail = messages.slice(lastUserIndex + 1)
  // 当前轮的助手回答（约定每轮至多一条）；流式且首块文本未到时可能尚不存在。
  const currentAnswer = tail.find((message) => message.role === "assistant")
  const hasActivity =
    thinking.length > 0 || toolCalls.length > 0 || subagents.length > 0
  const showTurn = Boolean(currentAnswer) || hasActivity

  return (
    <div
      className="kk-thread"
      role="log"
      aria-label="对话记录"
      aria-live="polite"
      onScroll={onScroll}
    >
      <div className="kk-thread__inner">
        {head.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isStreamingAssistant={false}
          />
        ))}

        {showTurn ? (
          <AssistantTurn
            message={currentAnswer}
            isStreamingAssistant={isStreaming && Boolean(currentAnswer)}
            thinking={thinking}
            toolCalls={toolCalls}
            subagents={subagents}
            isStreaming={isStreaming}
          />
        ) : null}

        {/* 状态槽常驻并保留固定高度：流式结束后不塌陷，避免对话上下跳动。 */}
        <p className="kk-thread__status">
          {isStreaming ? (
            <>
              正在输入
              <span className="kk-thread__pulse" aria-hidden>
                <span />
                <span />
                <span />
              </span>
            </>
          ) : null}
        </p>


        {hasFailed ? (
          <div className="kk-thread__error" role="alert">
            <span>这一轮没能完成，稍后再试一次。</span>
            <button
              className="kk-thread__retry"
              type="button"
              onClick={onRetry}
            >
              重试
            </button>
          </div>
        ) : null}

        <div ref={threadEndRef} />
      </div>
    </div>
  )
}
