import type { ChatProductCopy } from "./chat-copy"
import styles from "./chat-product.module.css"

export function TemporaryChatStatus(props: Readonly<{
  copy: Pick<ChatProductCopy, "temporaryChat" | "temporaryChatDescription">
}>) {
  return (
    <section className={styles.temporaryStatus} aria-label={props.copy.temporaryChat}>
      <strong>{props.copy.temporaryChat}</strong>
      <p>{props.copy.temporaryChatDescription}</p>
    </section>
  )
}
