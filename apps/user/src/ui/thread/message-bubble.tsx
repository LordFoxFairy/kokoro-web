import type { SessionMessage } from "@/core/state"

import styles from "./thread.module.css"

type MessageBubbleProps = {
  message: SessionMessage
}

// 用户消息：右侧柔暖胶囊、无头像无气泡尾。纯文本呈现，不把用户键入的 markdown 记号当语法解析。
export function MessageBubble({ message }: MessageBubbleProps) {
  return (
    <article className={styles.userMsg}>
      <div className={styles.userBubble}>
        <p className={styles.userBody}>{message.content}</p>
      </div>
    </article>
  )
}
