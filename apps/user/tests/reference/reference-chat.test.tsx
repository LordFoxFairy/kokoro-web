import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { ReferenceChatController, ReferenceChatState } from "@/reference/reference-chat-controller"
import { ReferenceChatView } from "@/reference/reference-chat"

afterEach(cleanup)

function controller(state: ReferenceChatState): ReferenceChatController {
  return {
    getSnapshot: () => state,
    subscribe: () => () => undefined,
    create: vi.fn(),
    open: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    selectModelOption: vi.fn(),
    decideAction: vi.fn(),
    decidePlan: vi.fn(),
    close: vi.fn(),
  }
}

const state: ReferenceChatState = {
  phase: "ready",
  sessionId: "session-1",
  snapshot: null,
  hitlDecisionSupported: true,
  chatCatalog: null,
  selectedModelOptionRevisionRef: null,
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

describe("reference typed Chat surface", () => {
  it("requires explicit risk acknowledgement before submitting an approval", () => {
    const value = controller(state)
    render(<ReferenceChatView brandName="Kokoro" controller={value} state={state} />)

    expect(screen.getByText("Approval required")).toBeInTheDocument()
    expect(screen.getByText(/approval-owner-1/)).toBeInTheDocument()
    expect(screen.getByText(/Version 3/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled()
    fireEvent.click(screen.getByRole("checkbox"))
    expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled()
    fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    expect(value.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      decision: { kind: "approve", payload: { acknowledged_risk: true } },
    }))
  })

  it("renders a safe selection interaction and submits only published option ids", () => {
    const interaction: ReferenceChatState = {
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
    render(<ReferenceChatView brandName="Kokoro" controller={value} state={interaction} />)

    fireEvent.click(screen.getByRole("radio", { name: "Short" }))
    fireEvent.click(screen.getByRole("button", { name: "Respond" }))

    expect(value.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      decision: { kind: "respond", payload: { input_schema_ref: "schema-1", response: { kind: "selection", payload: { selected_option_ids: ["short"] } } } },
    }))
  })

  it("rejects non-object JSON edits in the safe editor", () => {
    const approval = state.projection.messages[0]?.parts[0]
    if (approval?.kind !== "approval") throw new Error("Expected approval fixture")
    const editable: ReferenceChatState = {
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
    render(<ReferenceChatView brandName="Kokoro" controller={value} state={editable} />)

    fireEvent.change(screen.getByRole("textbox", { name: "Edited input for Approval required" }), { target: { value: "[]" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit edit" }))

    expect(screen.getByRole("alert")).toHaveTextContent("JSON object")
    expect(value.decideAction).not.toHaveBeenCalled()
  })

  it("requires an explicit boolean choice and a finite number for safe form responses", () => {
    const interaction: ReferenceChatState = {
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
    render(<ReferenceChatView brandName="Kokoro" controller={value} state={interaction} />)
    const respond = screen.getByRole("button", { name: "Respond" })

    fireEvent.change(screen.getByRole("combobox", { name: /Confirm/ }), { target: { value: "false" } })
    fireEvent.change(screen.getByRole("textbox", { name: /Amount/ }), { target: { value: "not-a-number" } })
    expect(respond).toBeDisabled()
    expect(screen.getByRole("alert")).toHaveTextContent("finite number")
    fireEvent.change(screen.getByRole("textbox", { name: /Amount/ }), { target: { value: "2.5" } })
    fireEvent.click(respond)

    expect(value.decideAction).toHaveBeenCalledWith(expect.objectContaining({
      decision: { kind: "respond", payload: { input_schema_ref: "schema-form", response: { kind: "form", payload: { fields: { confirm: false, amount: 2.5 } } } } },
    }))
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
