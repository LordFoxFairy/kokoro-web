import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { createChatProjection } from "@kokoro/chat-surface"
import { DEFAULT_CHAT_COPY } from "../src/chat-copy.js"
import type { ChatController, ChatState } from "../src/chat-controller.js"
import { ChatView } from "../src/chat-product.js"

function fixture() {
  const state: ChatState = {
    phase: "ready",
    sessionId: "session-12345678",
    projection: {
      ...createChatProjection(),
      session: { id: "session-12345678", projectRef: "project-12345678", title: "Core", lifecycle: "active", contextPolicy: "standard", version: 1 },
      connection: { kind: "live" },
    },
    failure: null,
    chatCatalog: {
      surfaceId: "chat", catalogRevisionRef: "catalog-12345678", defaultModelOptionRevisionRef: "model-option-12345678", publishedAt: "2026-08-11T00:00:00.000Z",
      options: [{ modelOptionRevisionRef: "model-option-12345678", optionKey: "standard", label: "Standard", inputModalities: ["text"], outputModalities: ["text"], supportedEfforts: [], badges: [], availability: "available" }],
    },
    selectedModelOptionRevisionRef: "model-option-12345678",
    selectedEffort: null,
    appliedDraft: null,
    hitlDecisionSupported: true,
  }
  const unavailable = async (): Promise<never> => { throw new Error("not used during static rendering") }
  const controller = {
    getSnapshot: () => state, subscribe: () => () => undefined, create: unavailable, open: unavailable, submit: unavailable,
    editMessage: unavailable, regenerateMessage: unavailable, forkBranch: unavailable, activateBranch: unavailable, cancel: unavailable,
    recover: async () => true, resumePendingCommand: async () => false, selectModelOption: () => undefined, selectEffort: () => undefined,
    decideAction: unavailable, decidePlan: unavailable, close: () => undefined,
  } satisfies ChatController
  const assetUploader = { upload: unavailable }
  return { state, controller, assetUploader }
}

describe("ChatProduct attachments profile", () => {
  it("hides the file input and attachment action only when attachments are disabled", () => {
    const { state, controller, assetUploader } = fixture()
    const disabled = renderToStaticMarkup(<ChatView attachmentsEnabled={false} assetUploader={assetUploader} brandName="Kokoro" controller={controller} copy={DEFAULT_CHAT_COPY} sessionId="session-12345678" state={state} />)
    const defaultEnabled = renderToStaticMarkup(<ChatView assetUploader={assetUploader} brandName="Kokoro" controller={controller} copy={DEFAULT_CHAT_COPY} sessionId="session-12345678" state={state} />)
    const explicitEnabled = renderToStaticMarkup(<ChatView attachmentsEnabled assetUploader={assetUploader} brandName="Kokoro" controller={controller} copy={DEFAULT_CHAT_COPY} sessionId="session-12345678" state={state} />)

    expect(disabled).not.toContain('type="file"')
    expect(disabled).not.toContain("Attach files")
    expect(defaultEnabled).toContain('type="file"')
    expect(defaultEnabled).toContain("Attach files")
    expect(explicitEnabled).toContain('type="file"')
  })
})
