import type { ChatProjectionMessage } from "@kokoro/chat-surface"

import type { ChatController } from "./chat-controller"
import type { ChatProductCopy } from "./chat-copy"

export type ConversationMessageRenderProps = Readonly<{
  message: ChatProjectionMessage
  controller: ChatController
  copy: ChatProductCopy
  commandPending: boolean
  mutationDisabled: boolean
}>

export function sameConversationMessageRender(
  previous: ConversationMessageRenderProps,
  next: ConversationMessageRenderProps,
): boolean {
  return previous.message === next.message &&
    previous.controller === next.controller &&
    previous.copy === next.copy &&
    previous.commandPending === next.commandPending &&
    previous.mutationDisabled === next.mutationDisabled
}
