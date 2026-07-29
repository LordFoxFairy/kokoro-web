import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ChatView, type ChatController, type ChatState } from "@kokoro/chat-app"
import { DEFAULT_CHAT_COPY } from "@kokoro/chat-app"

afterEach(cleanup)

function controller(state: ChatState): ChatController {
  return {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    create: vi.fn(),
    open: vi.fn(),
    submit: vi.fn(),
    editMessage: vi.fn(),
    regenerateMessage: vi.fn(),
    forkBranch: vi.fn(),
    activateBranch: vi.fn(),
    cancel: vi.fn(),
    selectModelOption: vi.fn(),
    selectEffort: vi.fn(),
    decideAction: vi.fn(),
    decidePlan: vi.fn(),
    close: vi.fn(),
  }
}

const state: ChatState = {
  phase: "ready",
  sessionId: "session-1",
  snapshot: null,
  hitlDecisionSupported: true,
  chatCatalog: null,
  selectedModelOptionRevisionRef: null,
  selectedEffort: null,
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
        decisionGroupRef: "decision-group-1",
        requiredOwnerRefs: ["approval-owner-1"],
        title: "Approval required",
        description: "Approve the requested effect",
        allowedActions: ["approve", "reject"],
        status: "pending",
      }],
    }],
  },
}

describe("Chat surface", () => {
  it("requires explicit risk acknowledgement before submitting an approval", () => {
    const value = controller(state)
    render(<ChatView brandName="Kokoro" copy={DEFAULT_CHAT_COPY} controller={value} state={state} />)

    expect(screen.getByText("Approval required")).toBeInTheDocument()
    expect(screen.queryByText(/approval-owner-1/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Version 3/)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox"))
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(value.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      decision: { kind: "approve", payload: { acknowledged_risk: true } },
    }))
  })

  it("renders a safe selection interaction and submits only published option ids", () => {
    const interaction: ChatState = {
      ...state,
      projection: {
        ...state.projection,
        messages: [{
          ...state.projection.messages[0]!,
          parts: [{
            id: "interaction-1", ordinal: 1, version: 1, lifecycle: "streaming", kind: "interaction",
            ownerRef: "interaction-owner-1", expectedVersion: 1, decisionGroupRef: "decision-group-2",
            requiredOwnerRefs: ["interaction-owner-1"], title: "Choose output", description: "Pick one",
            inputSchemaRef: "schema-1", safeInputSchema: { kind: "selection", options: [{ id: "short", label: "Short" }, { id: "long", label: "Long" }] },
            allowedActions: ["respond"], status: "pending",
          }],
        }],
      },
    }
    const value = controller(interaction)
    render(<ChatView brandName="Kokoro" copy={DEFAULT_CHAT_COPY} controller={value} state={interaction} />)

    fireEvent.click(screen.getByRole("radio", { name: "Short" }))
    fireEvent.click(screen.getByRole("button", { name: "Respond" }))

    expect(value.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      decision: { kind: "respond", payload: { input_schema_ref: "schema-1", response: { kind: "selection", payload: { selected_option_ids: ["short"] } } } },
    }))
  })

  it("rejects non-object JSON edits in the safe editor", () => {
    const approval = state.projection.messages[0]?.parts[0]
    if (approval?.kind !== "approval") throw new Error("Expected approval fixture")
    const editable: ChatState = {
      ...state,
      projection: {
        ...state.projection,
        messages: [{
          ...state.projection.messages[0]!,
          parts: [{ ...approval, inputSchemaRef: "schema-edit", allowedActions: ["edit"] }],
        }],
      },
    }
    const value = controller(editable)
    render(<ChatView brandName="Kokoro" copy={DEFAULT_CHAT_COPY} controller={value} state={editable} />)

    fireEvent.change(screen.getByRole("textbox", { name: "Edited action input" }), { target: { value: "[]" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit edit" }))

    expect(screen.getByRole("alert")).toHaveTextContent("Edited input must be an object.")
    expect(value.decideAction).not.toHaveBeenCalled()
  })

  it("requires an explicit boolean choice and a finite number for safe form responses", () => {
    const interaction: ChatState = {
      ...state,
      projection: {
        ...state.projection,
        messages: [{
          ...state.projection.messages[0]!,
          parts: [{
            id: "interaction-form", ordinal: 1, version: 1, lifecycle: "streaming", kind: "interaction",
            ownerRef: "interaction-owner-2", expectedVersion: 1, decisionGroupRef: "decision-group-3",
            requiredOwnerRefs: ["interaction-owner-2"], title: "Confirm values", description: "Complete the form",
            inputSchemaRef: "schema-form", safeInputSchema: {
              kind: "form", type: "object", required: ["confirm", "amount"], properties: {
                confirm: { type: "boolean", title: "Confirm" }, amount: { type: "number", title: "Amount" },
              },
            },
            allowedActions: ["respond"], status: "pending",
          }],
        }],
      },
    }
    const value = controller(interaction)
    render(<ChatView brandName="Kokoro" copy={DEFAULT_CHAT_COPY} controller={value} state={interaction} />)
    const respond = screen.getByRole("button", { name: "Respond" })

    fireEvent.change(screen.getByRole("combobox", { name: /Confirm/ }), { target: { value: "false" } })
    fireEvent.change(screen.getByRole("textbox", { name: /Amount/ }), { target: { value: "not-a-number" } })
    expect(respond).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a valid number before responding.")
    fireEvent.change(screen.getByRole("textbox", { name: /Amount/ }), { target: { value: "2.5" } })
    fireEvent.click(respond)

    expect(value.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      decision: { kind: "respond", payload: { input_schema_ref: "schema-form", response: { kind: "form", payload: { fields: { confirm: false, amount: 2.5 } } } } },
    }))
  })

  it("offers a real cancellation command for an active run", () => {
    const value = controller(state)
    render(<ChatView brandName="Kokoro" copy={DEFAULT_CHAT_COPY} controller={value} state={state} />)

    fireEvent.click(screen.getByRole("button", { name: "Stop" }))

    expect(value.cancel).toHaveBeenCalledOnce()
  })

  it("shows actionable failure copy without internal codes and disables submit without a published model revision", () => {
    const unavailable: ChatState = {
      ...state,
      projection: { ...state.projection, activeRunId: null, activeRunState: null },
      failure: {
        code: "MODEL_OPTION_UNAVAILABLE",
        action: "choose_model",
        retryClass: "after_user_action",
        message: "No published model option is available for this session.",
      },
    }
    render(<ChatView brandName="Kokoro" copy={DEFAULT_CHAT_COPY} controller={controller(unavailable)} state={unavailable} />)

    expect(screen.getByText("No published model option is available for this session.")).toBeInTheDocument()
    expect(screen.queryByText("MODEL_OPTION_UNAVAILABLE")).not.toBeInTheDocument()
    expect(screen.getByText(/choose_model/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled()
  })
})
