import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ChatPartView, ChatView, MarkdownText } from "../src/chat-product.js"
import { createChatProjection, type ChatPart, type ChatProjection } from "@kokoro/chat-surface"
import type { ChatController, ChatState } from "../src/chat-controller.js"
import { DEFAULT_CHAT_COPY } from "../src/chat-copy.js"

describe("Chat Markdown rendering", () => {
  it("uses grammar highlighting and exposes block-scoped copy and download controls", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text={"```typescript\nconst ready: boolean = true\n```"} />,
    )

    expect(html).toContain("hljs-keyword")
    expect(html).toContain("data-language=\"typescript\"")
    expect(html).toContain(">Copy<")
    expect(html).toContain(">Download<")
  })

  it("does not auto-load remote Markdown images in the browser", () => {
    const html = renderToStaticMarkup(
      <MarkdownText text="![tracking pixel](https://media.example/pixel.png)" />,
    )

    expect(html).not.toContain("<img")
    expect(html).toContain("href=\"https://media.example/pixel.png\"")
    expect(html).toContain("tracking pixel")
  })

  it("renders strict Media, Artifact, and Cost owner states without inventing delivery URLs", () => {
    const controller = {
      decideAction: async () => undefined,
      decidePlan: async () => undefined,
    }
    const common = { version: 1, lifecycle: "streaming" as const }
    const parts: readonly ChatPart[] = [
      { ...common, id: "reasoning-1", ordinal: 0, kind: "reasoning-summary", partRef: "reasoning-ref", text: "Compared safe alternatives" },
      { ...common, id: "plan-progress-1", ordinal: 1, kind: "plan-progress", planRef: "plan-ref", summary: "Building the result", steps: [{ stepRef: "step-1", label: "Render", status: "in_progress" }] },
      { ...common, id: "subagent-1", ordinal: 2, kind: "subagent", subagentRef: "subagent-ref", status: "running", summary: "Checking references" },
      { ...common, id: "media-1", ordinal: 3, kind: "media-operation", mediaOperationRef: "media-ref", definitionRef: "image.text_to_image", definitionRevisionRef: "image.text_to_image@1", ownerVersion: "7", state: "active", progressBps: 3750, candidates: [{ candidateRef: "candidate-producing", ordinal: 0, ownerVersion: "2", state: "producing" }, { candidateRef: "candidate-unknown", ordinal: 1, ownerVersion: "3", state: "unknown" }, { candidateRef: "candidate-restricted", ordinal: 2, ownerVersion: "4", state: "restricted", failure: { code: "artifact_restricted", retryClass: "never", safeMessage: "Not available for delivery." } }, { candidateRef: "candidate-ready", ordinal: 3, ownerVersion: "5", artifactRef: "artifact-final", artifactVersionRef: "artifact-v1", state: "ready" }], costProjection: { costProjectionRef: "cost-ref", ownerVersion: "2" }, updatedAt: "2026-07-28T00:00:00.000Z" },
      { ...common, id: "artifact-1", ordinal: 4, lifecycle: "completed", kind: "artifact", artifactRef: "artifact-final", artifactVersionRef: "artifact-v1", ownerVersion: "11", mediaClass: "image", availability: "ready", display: { format: "png", width: 1024, height: 768, byteSize: "245760" }, updatedAt: "2026-07-28T00:00:00.000Z" },
      { ...common, id: "artifact-2", ordinal: 5, lifecycle: "failed", kind: "artifact", artifactRef: "artifact-restricted", artifactVersionRef: "artifact-v2", ownerVersion: "12", mediaClass: "image", availability: "restricted", failure: { code: "artifact_restricted", retryClass: "never", safeMessage: "Restricted by policy." }, updatedAt: "2026-07-28T00:01:00.000Z" },
      { ...common, id: "cost-1", ordinal: 6, lifecycle: "completed", kind: "cost", mediaOperationRef: "media-ref", costProjectionRef: "cost-ref", ownerVersion: "13", state: "corrected", freshness: "stale", amount: { amount: "125", creditUnit: "credits" }, correctsOwnerVersion: "12", updatedAt: "2026-07-28T00:02:00.000Z" },
      { ...common, id: "cost-2", ordinal: 7, lifecycle: "failed", kind: "cost", mediaOperationRef: "media-ref", costProjectionRef: "cost-unavailable", ownerVersion: "14", state: "unavailable", freshness: "unavailable", safeReason: "Rating projection is temporarily unavailable.", updatedAt: "2026-07-28T00:03:00.000Z" },
      { ...common, id: "notice-1", ordinal: 8, lifecycle: "completed", kind: "notice", noticeRef: "notice-ref", code: "WAIT", message: "Still working", severity: "warning" },
      { ...common, id: "error-1", ordinal: 9, lifecycle: "failed", kind: "error", errorRef: "error-ref", code: "FAILED", message: "Stopped", retryClass: "never" },
      { ...common, id: "tool-1", ordinal: 10, lifecycle: "completed", kind: "tool", toolCallId: "tool-call-1", name: "Search", args: {}, result: "Partial preview", status: "complete", isError: true, truncated: true },
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
    expect(html).toContain("image.text_to_image@1")
    expect(html).toContain("candidate-unknown")
    expect(html).toContain("unknown")
    expect(html).toContain("candidate-restricted")
    expect(html).toContain("Not available for delivery.")
    expect(html).toContain("37.5%")
    expect(html).toContain("artifact-final")
    expect(html).toContain("Artifact")
    expect(html).toContain("artifact-v1")
    expect(html).toContain("1024 × 768")
    expect(html).toContain("245760")
    expect(html).toContain("Restricted by policy.")
    expect(html).toContain("125")
    expect(html).toContain("credits")
    expect(html).toContain("stale")
    expect(html).toContain("Rating projection is temporarily unavailable.")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("href=")
    expect(html).toContain("WAIT")
    expect(html).toContain("warning")
    expect(html).toContain("FAILED")
    expect(html).toContain("Tool error")
    expect(html).toContain("Result preview truncated")
    expect(html).toContain("data-result-error=\"true\"")
  })

  it("renders title, context policy, and branches only from the Chat projection", () => {
    const projection: ChatProjection = {
      ...createChatProjection(),
      session: {
        id: "session-12345678",
        projectRef: "project-12345678",
        title: "Renamed live",
        lifecycle: "active",
        contextPolicy: "temporary",
        version: 3,
      },
      branches: [{
        id: "branch-original-12345678",
        origin: "original",
        version: 1,
        createdAt: "2026-07-29T00:00:00.000Z",
      }, {
        id: "branch-fork-12345678",
        parentId: "branch-original-12345678",
        origin: "fork",
        version: 1,
        createdAt: "2026-07-29T00:01:00.000Z",
      }],
      activeBranchId: "branch-fork-12345678",
      snapshotRevision: "signed.cursor.3",
      connection: { kind: "live" },
    }
    const state: ChatState = {
      phase: "ready",
      sessionId: "session-12345678",
      projection,
      failure: null,
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
      resumePendingCommand: async () => false,
      selectModelOption: () => undefined,
      selectEffort: () => undefined,
      decideAction: unavailable,
      decidePlan: unavailable,
      close: () => undefined,
    } satisfies ChatController

    const html = renderToStaticMarkup(
      <ChatView brandName="Fallback brand" controller={controller} state={state} copy={DEFAULT_CHAT_COPY} sessionId="session-12345678" />,
    )

    expect(html).toContain("Renamed live")
    expect(html).toContain("Temporary chat")
    expect(html).toContain("value=\"branch-original-12345678\"")
    expect(html).toContain("value=\"branch-fork-12345678\"")
    expect(html).not.toContain("Fallback brand</h1>")
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
      projection,
      failure: {
        code: "INTERNAL_UNAVAILABLE",
        action: "refetch_snapshot",
        retryClass: "after_user_action",
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
      resumePendingCommand: async () => false,
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
