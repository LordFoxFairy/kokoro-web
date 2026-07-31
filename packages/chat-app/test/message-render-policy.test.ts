import type { ChatProjectionMessage } from "@kokoro/chat-surface"
import { describe, expect, it } from "vitest"

import type { ChatController } from "../src/chat-controller.js"
import { DEFAULT_CHAT_COPY } from "../src/chat-copy.js"
import {
  sameConversationMessageRender,
  type ConversationMessageRenderProps,
} from "../src/message-render-policy.js"

describe("conversation message render policy", () => {
  it("invalidates only the updated tail across an 80-message streaming window", () => {
    const controller = Object.freeze({}) as ChatController
    const messages: readonly ChatProjectionMessage[] = Array.from({ length: 80 }, (_, index) => Object.freeze({
      id: `message-${index}`,
      runId: index === 79 ? "run-tail" : null,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      createdAt: "2026-07-31T00:00:00.000Z",
      parts: Object.freeze([]),
      status: index === 79 ? "running" as const : "complete" as const,
    }))
    const props = (message: ChatProjectionMessage): ConversationMessageRenderProps => Object.freeze({
      message,
      controller,
      copy: DEFAULT_CHAT_COPY,
      commandPending: false,
      mutationDisabled: true,
    })
    const previous = messages.map(props)
    const next = messages.map((message, index) => props(index === 79
      ? Object.freeze({ ...message, parts: Object.freeze([]) })
      : message))

    expect(next.filter((candidate, index) => !sameConversationMessageRender(previous[index]!, candidate))).toHaveLength(1)
  })
})
