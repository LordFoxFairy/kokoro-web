import type { SessionMessage } from "@/application/session-stream-reducer"

import { RobotIcon, UserIcon } from "./icons"
import { MarkdownMessage } from "./markdown-message"

type MessageBubbleProps = {
  message: SessionMessage
}

export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <article className={`kk-msg kk-msg--${message.role}`}>
      {message.role === "assistant" ? (
        <div className="kk-msg__avatar kk-msg__avatar--bot" aria-hidden>
          <RobotIcon />
        </div>
      ) : null}
      <div className="kk-msg__bubble">
        {message.role === "assistant" ? (
          <MarkdownMessage content={message.content} />
        ) : (
          // 用户输入保持纯文本：原样呈现，绝不把用户键入的 markdown 记号当语法解析。
          <p className="kk-msg__body">{message.content}</p>
        )}
      </div>
      {message.role === "user" ? (
        <div className="kk-msg__avatar kk-msg__avatar--user" aria-hidden>
          <UserIcon />
        </div>
      ) : null}
    </article>
  )
}
