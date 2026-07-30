import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ChatView, MarkdownText } from "../src/chat-product.js"
import { createChatProjection, type ChatProjection } from "@kokoro/chat-surface"
import type { ChatController, ChatState } from "../src/chat-controller.js"
import { DEFAULT_CHAT_COPY } from "../src/chat-copy.js"

describe("Chat Markdown rendering", () => {
  it("uses grammar highlighting and exposes a block-scoped copy control", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text={"```typescript\nconst ready: boolean = true\n```"} />,
    )

    expect(html).toContain("hljs-keyword")
    expect(html).toContain("data-language=\"typescript\"")
    expect(html).toContain(">Copy<")
  })

  it("does not auto-load remote Markdown images in the browser", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="![tracking pixel](https://media.example/pixel.png)" />,
    )

    expect(html).not.toContain("<img")
    expect(html).toContain("href=\"https://media.example/pixel.png\"")
    expect(html).toContain("tracking pixel")
  })

  it("renders a safe recovery control instead of an internal action token", () => {
    const projection: ChatProjection = {
      ...createChatProjection(),
      connection: { kind: "repair_required", recovery: { kind: "rehydrate", reason: "cursor_expired" } },
      repair: { required: true, reason: "cursor_expired" },
    }
    const state: ChatState = {
      phase: "ready",
      sessionId: "session-12345678",
      snapshot: null,
      projection,
      failure: {
        code: "INTERNAL_UNAVAILABLE",
        action: "refetch_snapshot",
        retryClass: "immediate",
        message: "Chat is temporarily unavailable.",
      },
      chatCatalog: null,
      selectedModelOptionRevisionRef: null,
      selectedEffort: null,
      appliedDraft: null,
      hitlDecisionSupported: true,
    }
    const unavailable = async (..._args: readonly unknown[]): Promise<never> => {
      throw new Error("not used during server rendering")
    }
    const controller = {
      getSnapshot: () => state,
      subscribe: () => () => undefined,
      create: unavailable,
      open: unavailable,
      submit: unavailable,
      editMessage: unavailable,
      regenerateMessage: unavailable,
      forkBranch: unavailable,
      activateBranch: unavailable,
      cancel: unavailable,
      recover: async () => true,
      selectModelOption: () => undefined,
      selectEffort: () => undefined,
      decideAction: unavailable,
      decidePlan: unavailable,
      close: () => undefined,
    } satisfies ChatController

    const html = renderToStaticMarkup(
      <ChatView brandName="Kokoro" controller={controller} state={state} copy={DEFAULT_CHAT_COPY} sessionId="session-12345678" />,
    )

    expect(html).toContain(">Refresh conversation<")
    expect(html).not.toContain("refetch_snapshot")
  })
})
