import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ChatPartView, ChatView, MarkdownText } from "../src/chat-product.js"
import { createChatProjection, type ChatPart, type ChatProjection } from "@kokoro/chat-surface"
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

  it("renders plan progress, subagent, Media operation, and artifact projections as distinct cards", () => {
    const controller = {
      decideAction: async () => undefined,
      decidePlan: async () => undefined,
    }
    const common = { version: 1, lifecycle: "streaming" as const }
    const parts: readonly ChatPart[] = [
      { ...common, id: "reasoning-1", ordinal: 0, kind: "reasoning-summary", partRef: "reasoning-ref", text: "Compared safe alternatives" },
      { ...common, id: "plan-progress-1", ordinal: 1, kind: "plan-progress", planRef: "plan-ref", summary: "Building the result", steps: [{ stepRef: "step-1", label: "Render", status: "in_progress" }] },
      { ...common, id: "subagent-1", ordinal: 2, kind: "subagent", subagentRef: "subagent-ref", status: "running", summary: "Checking references" },
      { ...common, id: "media-1", ordinal: 3, kind: "media-operation", mediaOperationRef: "media-ref", capability: "image.generate", status: "running", progressBps: 3750, artifactRef: "artifact-final", safeMetadata: { title: "Poster", stage: "render" } },
      { ...common, id: "artifact-1", ordinal: 4, lifecycle: "completed", kind: "artifact", artifactRef: "artifact-final", versionRef: "artifact-v1", contentType: "image/png", safeMetadata: { title: "Poster" } },
      { ...common, id: "notice-1", ordinal: 5, lifecycle: "completed", kind: "notice", noticeRef: "notice-ref", code: "WAIT", message: "Still working", severity: "warning" },
      { ...common, id: "error-1", ordinal: 6, lifecycle: "failed", kind: "error", errorRef: "error-ref", code: "FAILED", message: "Stopped", retryClass: "never" },
      { ...common, id: "tool-1", ordinal: 7, lifecycle: "completed", kind: "tool", toolCallId: "tool-call-1", name: "Search", args: {}, result: "Partial preview", status: "complete", isError: true, truncated: true },
    ]
    const html = parts.map((part) => renderToStaticMarkup(
      <ChatPartView controller={controller} copy={DEFAULT_CHAT_COPY} disabled={false} part={part} runId="run-12345678" />,
    )).join("")

    expect(html).toContain("Reasoning summary")
    expect(html).toContain("Plan progress")
    expect(html).toContain("Building the result")
    expect(html).toContain("Subagent")
    expect(html).toContain("Checking references")
    expect(html).toContain("Media operation")
    expect(html).toContain("image.generate")
    expect(html).toContain("Poster")
    expect(html).toContain("render")
    expect(html).toContain("37.5%")
    expect(html).toContain("artifact-final")
    expect(html).toContain("Artifact")
    expect(html).toContain("artifact-v1")
    expect(html).toContain("image/png")
    expect(html).toContain("WAIT")
    expect(html).toContain("warning")
    expect(html).toContain("FAILED")
    expect(html).toContain("Tool error")
    expect(html).toContain("Result preview truncated")
    expect(html).toContain("data-result-error=\"true\"")
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
