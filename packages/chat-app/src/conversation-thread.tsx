"use client"

import type { ChatProjectionMessage } from "@kokoro/chat-surface"
import {
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { ChatProductCopy } from "./chat-copy"
import {
  INITIAL_CONVERSATION_WINDOW,
  type ConversationFollowState,
  conversationFollowState,
  conversationWindow,
  earlierConversationWindowStart,
  initialConversationWindowStart,
  isNearConversationEnd,
  prependAnchoredScrollTop,
} from "./conversation-window"
import styles from "./chat-product.module.css"

type ScrollAnchor = Readonly<{ scrollHeight: number; scrollTop: number }>

export function ConversationThread(props: Readonly<{
  copy: ChatProductCopy
  isStreaming: boolean
  messages: readonly ChatProjectionMessage[]
  phase: "idle" | "loading" | "ready" | "not_found"
  renderMessage(message: ChatProjectionMessage): ReactNode
}>) {
  const viewportRef = useRef<HTMLElement | null>(null)
  const prependAnchorRef = useRef<ScrollAnchor | null>(null)
  const previousTailRef = useRef<ChatProjectionMessage | null>(null)
  const [visibleFrom, setVisibleFrom] = useState(() => initialConversationWindowStart(
    props.messages.length,
    INITIAL_CONVERSATION_WINDOW,
  ))
  const [followState, setFollowState] = useState<ConversationFollowState>(() => Object.freeze({
    following: true,
    newContentAvailable: false,
  }))
  const window = useMemo(
    () => conversationWindow(props.messages, visibleFrom),
    [props.messages, visibleFrom],
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const prependAnchor = prependAnchorRef.current
    if (prependAnchor !== null) {
      prependAnchorRef.current = null
      viewport.scrollTop = prependAnchoredScrollTop(prependAnchor, viewport.scrollHeight)
      return
    }

    const tail = props.messages.at(-1) ?? null
    const receivedContent = previousTailRef.current !== null && previousTailRef.current !== tail
    previousTailRef.current = tail
    if (followState.following) {
      viewport.scrollTop = viewport.scrollHeight
      setFollowState((current) => conversationFollowState(current, { type: "jump_to_latest" }))
      const tailWindowStart = initialConversationWindowStart(props.messages.length)
      setVisibleFrom((current) => current === tailWindowStart ? current : tailWindowStart)
    } else if (receivedContent) {
      setFollowState((current) => conversationFollowState(current, { type: "content_received" }))
    }
  }, [followState.following, props.messages, visibleFrom])

  const revealEarlier = (): void => {
    const viewport = viewportRef.current
    if (viewport !== null) {
      prependAnchorRef.current = Object.freeze({
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      })
    }
    setVisibleFrom((current) => earlierConversationWindowStart(current))
  }

  const onScroll = (): void => {
    const viewport = viewportRef.current
    if (viewport === null) return
    const nearEnd = isNearConversationEnd(viewport)
    setFollowState((current) => conversationFollowState(current, { type: "scrolled", nearEnd }))
  }

  const jumpToLatest = (): void => {
    const viewport = viewportRef.current
    if (viewport !== null) viewport.scrollTop = viewport.scrollHeight
    setVisibleFrom(initialConversationWindowStart(props.messages.length))
    setFollowState((current) => conversationFollowState(current, { type: "jump_to_latest" }))
  }

  return <section
    aria-busy={props.isStreaming}
    aria-label={props.copy.conversation}
    className={styles.thread}
    data-following={followState.following}
    onScroll={onScroll}
    ref={viewportRef}
    tabIndex={0}
  >
    {props.phase === "loading" ? <p className={styles.empty}>{props.copy.loading}</p> : null}
    {props.phase === "not_found" ? <p className={styles.empty}>{props.copy.notFound}</p> : null}
    {props.messages.length === 0 && props.phase === "ready" ? <div className={styles.emptyState}><span aria-hidden>✦</span><h2>{props.copy.emptyTitle}</h2><p>{props.copy.emptyDescription}</p></div> : null}
    {window.hiddenCount > 0 ? <button className={styles.earlierMessages} onClick={revealEarlier} type="button">{props.copy.showEarlierMessages} · {window.hiddenCount}</button> : null}
    {window.visibleMessages.map(props.renderMessage)}
    {followState.newContentAvailable ? <div aria-atomic="true" aria-live="polite" className={styles.newContentNotice} role="status"><button className={styles.jumpToLatest} onClick={jumpToLatest} type="button">{props.copy.jumpToLatest}</button></div> : null}
  </section>
}
