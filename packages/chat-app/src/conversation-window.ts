export const INITIAL_CONVERSATION_WINDOW = 80
export const CONVERSATION_WINDOW_PAGE = 40
export const CONVERSATION_END_THRESHOLD_PX = 96

export type ConversationWindow<Message> = Readonly<{
  visibleMessages: readonly Message[]
  hiddenCount: number
}>

export function conversationWindow<Message>(
  messages: readonly Message[],
  requestedStart: number,
): ConversationWindow<Message> {
  const hiddenCount = Math.max(0, Math.min(messages.length, Math.floor(requestedStart)))
  return Object.freeze({
    visibleMessages: Object.freeze(messages.slice(hiddenCount)),
    hiddenCount,
  })
}

export function initialConversationWindowStart(
  messageCount: number,
  windowSize = INITIAL_CONVERSATION_WINDOW,
): number {
  return Math.max(0, Math.floor(messageCount) - Math.max(0, Math.floor(windowSize)))
}

export function earlierConversationWindowStart(
  currentStart: number,
  pageSize = CONVERSATION_WINDOW_PAGE,
): number {
  return Math.max(0, Math.floor(currentStart) - Math.max(0, Math.floor(pageSize)))
}

export function isNearConversationEnd(input: Readonly<{
  scrollHeight: number
  scrollTop: number
  clientHeight: number
  threshold?: number
}>): boolean {
  const threshold = input.threshold ?? CONVERSATION_END_THRESHOLD_PX
  const distance = Math.max(0, input.scrollHeight - input.clientHeight - input.scrollTop)
  return distance <= Math.max(0, threshold)
}

export type ConversationFollowState = Readonly<{
  following: boolean
  newContentAvailable: boolean
}>

export type ConversationFollowEvent =
  | Readonly<{ type: "scrolled"; nearEnd: boolean }>
  | Readonly<{ type: "content_received" }>
  | Readonly<{ type: "jump_to_latest" }>

export function conversationFollowState(
  state: ConversationFollowState,
  event: ConversationFollowEvent,
): ConversationFollowState {
  switch (event.type) {
    case "scrolled":
      if (
        state.following === event.nearEnd &&
        (!event.nearEnd || state.newContentAvailable === false)
      ) return state
      return Object.freeze({
        following: event.nearEnd,
        newContentAvailable: event.nearEnd ? false : state.newContentAvailable,
      })
    case "content_received":
      if (state.following || state.newContentAvailable) return state
      return Object.freeze({ following: false, newContentAvailable: true })
    case "jump_to_latest":
      if (state.following && !state.newContentAvailable) return state
      return Object.freeze({ following: true, newContentAvailable: false })
  }
}

export function prependAnchoredScrollTop(
  anchor: Readonly<{ scrollHeight: number; scrollTop: number }>,
  currentScrollHeight: number,
): number {
  return Math.max(0, anchor.scrollTop + currentScrollHeight - anchor.scrollHeight)
}
