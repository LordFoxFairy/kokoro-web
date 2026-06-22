import type { SessionMessage } from "@/application/session-stream/reducer"

type MessageBubbleProps = {
  message: SessionMessage
}

// 用户消息：右侧柔暖胶囊、无头像无气泡尾。纯文本呈现，不把用户键入的 markdown 记号当语法解析。
export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <article className="kk-msg kk-msg--user">
      <div className="kk-msg__bubble">
        <p className="kk-msg__body">{message.content}</p>
      </div>
    </article>
  )
}
