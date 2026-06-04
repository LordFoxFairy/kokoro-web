import type { SessionMessage } from "@/application/session-stream-reducer"

import { RobotIcon, UserIcon } from "./icons"

type MessageBubbleProps = {
  message: SessionMessage
  isStreamingAssistant: boolean
}

export function MessageBubble({
  message,
  isStreamingAssistant,
}: MessageBubbleProps) {
  return (
    // 流式中正在生长的助手气泡用 aria-atomic 包成一个整体：
    // 每次增量按整段播报，而非把整条 log 重读一遍。其余历史气泡
    // 沿用 log 默认的“仅播报新增”，不被反复朗读。
    <article
      className={`kk-msg kk-msg--${message.role}`}
      aria-atomic={isStreamingAssistant ? true : undefined}
    >
      {message.role === "assistant" ? (
        <div className="kk-msg__avatar kk-msg__avatar--bot" aria-hidden>
          <RobotIcon />
        </div>
      ) : null}
      <div className="kk-msg__bubble">
        <p className="kk-msg__body">{message.content}</p>
      </div>
      {message.role === "user" ? (
        <div className="kk-msg__avatar kk-msg__avatar--user" aria-hidden>
          <UserIcon />
        </div>
      ) : null}
    </article>
  )
}
