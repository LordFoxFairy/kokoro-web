import type { RefObject, UIEvent } from "react"

import type { AgentMode } from "@/application/conversation-store"
import type {
  SegmentActivity,
  SessionMessage,
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
  activityByMessageId: Record<string, SegmentActivity>
  // 本会话模式：透传给每段助手的过程块，驱动 Fast/Thinking 的密度差异。
  mode: AgentMode
}

export function ConversationThread({
  messages,
  isStreaming,
  hasFailed,
  onRetry,
  onScroll,
  threadEndRef,
  activityByMessageId,
  mode,
}: ConversationThreadProps) {
  // 每条 assistant message 都要就近挂自己的过程块；若过程先到、正文未到，
  // 还要给当前正在生成的那一段预留一个“无正文的 assistant turn”。
  const messageIds = new Set(messages.map((message) => message.id))
  const orphanActivities = Object.values(activityByMessageId).filter(
    (activity) => !messageIds.has(activity.messageId),
  )
  const liveMessageId =
    isStreaming && orphanActivities.length === 0
      ? [...messages]
          .reverse()
          .find((message) => message.role === "assistant")
          ?.id
      : undefined

  return (
    <div
      className="kk-thread"
      role="log"
      aria-label="对话记录"
      aria-live="polite"
      onScroll={onScroll}
    >
      <div className="kk-thread__inner">
        {messages.map((message) =>
          message.role === "assistant" ? (
            <AssistantTurn
              key={message.id}
              message={message}
              activity={activityByMessageId[message.id]}
              isStreamingAssistant={message.id === liveMessageId}
              isStreaming={message.id === liveMessageId}
              mode={mode}
            />
          ) : (
            <MessageBubble
              key={message.id}
              message={message}
              isStreamingAssistant={false}
            />
          ),
        )}

        {orphanActivities.map((activity) => (
          <AssistantTurn
            key={activity.messageId}
            activity={activity}
            isStreamingAssistant={isStreaming}
            isStreaming={isStreaming}
            mode={mode}
          />
        ))}

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
