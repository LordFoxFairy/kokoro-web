import type { RefObject, UIEvent } from "react"

import type { SessionMessage } from "@/application/session-stream-reducer"

import { MessageBubble } from "./message-bubble"

type ConversationThreadProps = {
  messages: SessionMessage[]
  isStreaming: boolean
  hasFailed: boolean
  onRetry: () => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  threadEndRef: RefObject<HTMLDivElement | null>
}

export function ConversationThread({
  messages,
  isStreaming,
  hasFailed,
  onRetry,
  onScroll,
  threadEndRef,
}: ConversationThreadProps) {
  return (
    <div
      className="kk-thread"
      role="log"
      aria-label="对话记录"
      aria-live="polite"
      onScroll={onScroll}
    >
      <div className="kk-thread__inner">
        {messages.map((message, index) => {
          const isStreamingAssistant =
            isStreaming &&
            message.role === "assistant" &&
            index === messages.length - 1

          return (
            <MessageBubble
              key={message.id}
              message={message}
              isStreamingAssistant={isStreamingAssistant}
            />
          )
        })}

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
