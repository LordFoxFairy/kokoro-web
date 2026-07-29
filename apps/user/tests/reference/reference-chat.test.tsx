import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReferenceChatController, ReferenceChatState } from "@/reference/reference-chat-controller"
import { ReferenceChatView } from "@/reference/reference-chat"

afterEach(cleanup)

function controller(state: ReferenceChatState): ReferenceChatController {
  return {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    open: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
  }
}

const state: ReferenceChatState = {
  phase: "ready",
  sessionId: "session-1",
  snapshot: null,
  hitlDecisionSupported: false,
  failure: null,
  projection: {
    activeBranchId: "branch-1",
    activeRunId: "run-1",
    activeRunState: "paused",
    connection: { kind: "live" },
    command: { state: "idle" },
    repair: { required: false },
    messages: [{
      id: "assistant-1",
      runId: "run-1",
      role: "assistant",
      createdAt: "2026-07-29T12:00:00.000Z",
      status: "running",
      parts: [{
        id: "approval-1",
        ordinal: 1,
        version: 3,
        lifecycle: "streaming",
        kind: "approval",
        ownerRef: "approval-owner-1",
        expectedVersion: 3,
        allowedActions: ["approve", "reject"],
        status: "awaiting",
      }],
    }],
  },
}

describe("reference typed Chat surface", () => {
  it("renders HITL owner/version/actions without pretending the missing decision API exists", () => {
    render(<ReferenceChatView brandName="Kokoro" controller={controller(state)} state={state} />)

    expect(screen.getByText("Approval required")).toBeInTheDocument()
    expect(screen.getByText(/approval-owner-1/)).toBeInTheDocument()
    expect(screen.getByText(/Version 3/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "approve" })).toBeDisabled()
    expect(screen.getByText(/decision API is not available/i)).toBeInTheDocument()
  })

  it("offers a real cancellation command for an active run", () => {
    const value = controller(state)
    render(<ReferenceChatView brandName="Kokoro" controller={value} state={state} />)

    fireEvent.click(screen.getByRole("button", { name: "Stop run" }))

    expect(value.cancel).toHaveBeenCalledOnce()
  })

  it("shows stable failure code/action and disables submit without a published model revision", () => {
    const unavailable: ReferenceChatState = {
      ...state,
      projection: { ...state.projection, activeRunId: null, activeRunState: null },
      failure: {
        code: "MODEL_OPTION_UNAVAILABLE",
        action: "choose_model",
        retryClass: "after_user_action",
        message: "No published model option is available for this session.",
      },
    }
    render(<ReferenceChatView brandName="Kokoro" controller={controller(unavailable)} state={unavailable} />)

    expect(screen.getByText("MODEL_OPTION_UNAVAILABLE")).toBeInTheDocument()
    expect(screen.getByText(/choose_model/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  })
})
