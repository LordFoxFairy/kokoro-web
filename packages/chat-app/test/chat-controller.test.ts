import {
  SessionClientError,
  type EventStreamHandle,
  type OpenEventsInput,
  type SessionClient,
  type SessionCursor,
  type SessionHydration,
} from "@kokoro/session-client"
import type {
  SessionCommandResponse,
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"
import type { ChatPart } from "@kokoro/chat-surface"
import { describe, expect, it, vi } from "vitest"

import { createChatController } from "../src/chat-controller.js"
import type { SessionCommandRecoveryRecord, SessionCommandRecoveryStore } from "../src/command-recovery.js"

const NOW = "2026-07-29T00:00:00.000Z"

function snapshot(
  branchId: string,
  cursor: string,
  durableSeq: string,
  contextPolicy: "standard" | "temporary" = "standard",
): SessionSnapshot {
  return {
    session: {
      session_id: "session-12345678",
      project_ref: "project-12345678",
      title: "Recovery",
      lifecycle: "active",
      context_policy: contextPolicy,
      active_branch_id: branchId,
      version: Number(durableSeq),
      created_at: NOW,
      updated_at: NOW,
    },
    branches: [{
      branch_id: branchId,
      origin: "original",
      version: Number(durableSeq),
      created_at: NOW,
    }],
    messages: [],
    run_launches: [],
    runs: [],
    controls: [],
    costs: [],
    model_history: [],
    snapshot_watermark: {
      cursor,
      stream_epoch: "epoch-12345678",
      durable_seq: durableSeq,
      projection_version: Number(durableSeq),
    },
  }
}

function withAssistantText(base: SessionSnapshot, text: string): SessionSnapshot {
  const messageId = "message-assistant-12345678"
  return {
    ...base,
    session: { ...base.session, active_leaf_message_id: messageId },
    branches: base.branches.map((branch) => branch.branch_id === base.session.active_branch_id
      ? { ...branch, root_message_id: messageId, leaf_message_id: messageId }
      : branch),
    messages: [{
      message_id: messageId,
      branch_id: base.session.active_branch_id,
      role: "assistant",
      ordinal: 0,
      lifecycle: "completed",
      parts: [{
        part_id: "part-assistant-12345678",
        message_id: messageId,
        ordinal: 0,
        version: 1,
        schema_version: 1,
        lifecycle: "completed",
        kind: "text",
        payload: { spans: [{ text }] },
      }],
      attachments: [],
      created_at: NOW,
    }],
  }
}

function branchActivated(branchId: string): SessionEvent {
  return {
    kind: "branch.activated",
    event_id: "event-12345678",
    cursor: "signed.cursor.2",
    session_id: "session-12345678",
    stream_epoch: "epoch-12345678",
    durable_seq: "2",
    projection_version: 2,
    schema_revision: 3,
    recorded_at: NOW,
    payload: { branch_id: branchId, session_version: 2 },
  }
}

function sessionUpdated(contextPolicy: "standard" | "temporary"): SessionEvent {
  const current = snapshot("branch-original-12345678", "signed.cursor.2", "2", contextPolicy)
  return {
    kind: "session.updated",
    event_id: "event-session-updated-12345678",
    cursor: "signed.cursor.2",
    session_id: current.session.session_id,
    stream_epoch: "epoch-12345678",
    durable_seq: "2",
    projection_version: 2,
    schema_revision: 3,
    recorded_at: NOW,
    payload: { session: current.session },
  }
}

function branchCreated(branchId: string): SessionEvent {
  return {
    kind: "branch.created",
    event_id: "event-branch-created-12345678",
    cursor: "signed.cursor.2",
    session_id: "session-12345678",
    stream_epoch: "epoch-12345678",
    durable_seq: "2",
    projection_version: 1,
    schema_revision: 3,
    recorded_at: NOW,
    payload: {
      branch: {
        branch_id: branchId,
        parent_branch_id: "branch-original-12345678",
        origin: "fork",
        version: 1,
        created_at: NOW,
      },
    },
  }
}

function acceptedRunLaunch(command: SessionCommandRecoveryRecord["command"]): SessionCommandResponse {
  return {
    command_receipt: {
      operation: "submit_message",
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      digest_algorithm: command.digest_algorithm,
      request_digest: command.request_digest,
      updated_at: NOW,
      status: "accepted",
      payload: {
        kind: "run-launch-created",
        payload: {
          session_id: "session-12345678",
          branch_id: "branch-temporary-12345678",
          trigger_message_id: "message-user-12345678",
          assistant_message_id: "message-assistant-12345678",
          launch_id: "launch-12345678",
          proposed_run_id: "run-12345678",
          session_version: 2,
          branch_version: 2,
        },
      },
    },
  }
}

function appliedSessionCreation(
  command: SessionCommandRecoveryRecord["command"],
  contextPolicy: "standard" | "temporary",
): SessionCommandResponse {
  return {
    command_receipt: {
      operation: "create_session",
      command_id: command.command_id,
      idempotency_key: command.idempotency_key,
      digest_algorithm: command.digest_algorithm,
      request_digest: command.request_digest,
      updated_at: NOW,
      status: "applied",
      payload: {
        kind: "session-created",
        payload: {
          session_id: "session-12345678",
          initial_branch_id: "branch-temporary-12345678",
          session_version: 1,
          context_policy: contextPolicy,
        },
      },
    },
  }
}

function clientFixture(input: Readonly<{
  initial: SessionSnapshot
  fetchSnapshot: SessionClient["fetchSnapshot"]
  hydrate?: SessionClient["hydrate"]
  getCommandReceipt?: SessionClient["getCommandReceipt"]
  createSession?: SessionClient["createSession"]
  submitMessage?: SessionClient["submitMessage"]
  editMessage?: SessionClient["editMessage"]
  regenerateMessage?: SessionClient["regenerateMessage"]
  forkBranch?: SessionClient["forkBranch"]
  activateBranch?: SessionClient["activateBranch"]
  cancelRun?: SessionClient["cancelRun"]
  decideAction?: SessionClient["decideAction"]
  decidePlan?: SessionClient["decidePlan"]
}>) {
  const streams: OpenEventsInput[] = []
  const streamHandles: EventStreamHandle[] = []
  const unavailable = async (..._args: readonly unknown[]): Promise<never> => {
    throw new Error("operation is outside this fixture")
  }
  const client = {
    fetchSnapshot: input.fetchSnapshot,
    hydrate: input.hydrate ?? vi.fn(async (): Promise<SessionHydration> => ({
      kind: "ready",
      snapshot: input.initial,
      watermark: input.initial.snapshot_watermark,
      cursor: input.initial.snapshot_watermark.cursor as SessionCursor,
    })),
    listSessions: unavailable,
    createSession: input.createSession ?? unavailable,
    submitMessage: input.submitMessage ?? unavailable,
    editMessage: input.editMessage ?? unavailable,
    regenerateMessage: input.regenerateMessage ?? unavailable,
    forkBranch: input.forkBranch ?? unavailable,
    activateBranch: input.activateBranch ?? unavailable,
    cancelRun: input.cancelRun ?? unavailable,
    decideAction: input.decideAction ?? unavailable,
    decidePlan: input.decidePlan ?? unavailable,
    getCommandReceipt: input.getCommandReceipt ?? unavailable,
    updateSession: unavailable,
    archiveSession: unavailable,
    restoreSession: unavailable,
    trashSession: unavailable,
    putPreference: unavailable,
    listFolders: unavailable,
    createFolder: unavailable,
    updateFolder: unavailable,
    deleteFolder: unavailable,
    openEvents(eventInput: OpenEventsInput): EventStreamHandle {
      streams.push(eventInput)
      const handle = { ready: Promise.resolve(), close: vi.fn() }
      streamHandles.push(handle)
      return handle
    },
  } satisfies SessionClient
  return { client, streams, streamHandles }
}

describe("Chat recovery controller", () => {
  it("keeps an invalid hydration out of ready/live and fail-closes every Session mutation", async () => {
    const valid = snapshot("branch-original-12345678", "signed.cursor.2", "2")
    const run = {
      run_id: "run-12345678",
      launch_id: "launch-12345678",
      branch_id: valid.session.active_branch_id,
      assistant_message_id: "message-assistant-12345678",
      execution_status: "running" as const,
      cost_status: "committed" as const,
      last_durable_cursor: "signed.cursor.1",
      projection_version: 1,
    }
    const invalid: SessionSnapshot = { ...withAssistantText(valid, "must not render"), branches: [] }
    let resolveSnapshot: ((value: SessionSnapshot) => void) | undefined
    const fetchSnapshot = vi.fn<SessionClient["fetchSnapshot"]>(() => new Promise((resolve) => {
      resolveSnapshot = (value) => resolve(value)
    }))
    const submitMessage = vi.fn<SessionClient["submitMessage"]>()
    const editMessage = vi.fn<SessionClient["editMessage"]>()
    const regenerateMessage = vi.fn<SessionClient["regenerateMessage"]>()
    const forkBranch = vi.fn<SessionClient["forkBranch"]>()
    const activateBranch = vi.fn<SessionClient["activateBranch"]>()
    const cancelRun = vi.fn<SessionClient["cancelRun"]>()
    const decideAction = vi.fn<SessionClient["decideAction"]>()
    const decidePlan = vi.fn<SessionClient["decidePlan"]>()
    const { client, streams } = clientFixture({
      initial: invalid,
      fetchSnapshot,
      submitMessage,
      editMessage,
      regenerateMessage,
      forkBranch,
      activateBranch,
      cancelRun,
      decideAction,
      decidePlan,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: valid.session.project_ref,
    })

    await controller.open(valid.session.session_id)
    expect(controller.getSnapshot()).toMatchObject({
      phase: "loading",
      failure: { code: "SNAPSHOT_REQUIRED", action: "refetch_snapshot" },
      projection: {
        session: null,
        messages: [],
        connection: { kind: "reconnecting" },
        repair: { required: true, reason: "snapshot_active_branch_missing" },
      },
      selectedModelOptionRevisionRef: null,
      selectedEffort: null,
    })
    expect(streams).toHaveLength(0)

    const approval: Extract<ChatPart, { kind: "approval" }> = {
      id: "approval-part-12345678",
      ordinal: 0,
      version: 1,
      lifecycle: "streaming",
      kind: "approval",
      ownerRef: "approval-owner-12345678",
      expectedVersion: 1,
      decisionGroupRef: "decision-group-12345678",
      requiredOwnerRefs: ["approval-owner-12345678"],
      title: "Approve",
      description: "Approve action",
      allowedActions: ["approve", "reject"],
      status: "pending",
    }
    const plan: Extract<ChatPart, { kind: "plan" }> = {
      id: "plan-part-12345678",
      ordinal: 1,
      version: 1,
      lifecycle: "streaming",
      kind: "plan",
      planProposalRef: "plan-proposal-12345678",
      planVersion: 1,
      summary: "Plan",
      steps: [],
      allowedActions: ["accept", "reject"],
      status: "pending",
    }
    await expect(controller.submit("blocked")).resolves.toBe(false)
    await expect(controller.editMessage("message-user-12345678", "blocked")).resolves.toBe(false)
    await expect(controller.regenerateMessage("message-assistant-12345678")).resolves.toBe(false)
    await expect(controller.forkBranch(valid.session.active_branch_id)).resolves.toBe(false)
    await expect(controller.activateBranch(valid.session.active_branch_id)).resolves.toBe(false)
    await controller.cancel()
    await controller.decideAction({
      runId: run.run_id,
      partId: approval.id,
      decision: { kind: "approve", payload: { acknowledged_risk: true } },
    })
    await controller.decidePlan({ runId: run.run_id, partId: plan.id, decision: { kind: "accept", payload: {} } })
    expect(submitMessage).not.toHaveBeenCalled()
    expect(editMessage).not.toHaveBeenCalled()
    expect(regenerateMessage).not.toHaveBeenCalled()
    expect(forkBranch).not.toHaveBeenCalled()
    expect(activateBranch).not.toHaveBeenCalled()
    expect(cancelRun).not.toHaveBeenCalled()
    expect(decideAction).not.toHaveBeenCalled()
    expect(decidePlan).not.toHaveBeenCalled()

    const firstRepair = controller.recover()
    const secondRepair = controller.recover()
    expect(fetchSnapshot).toHaveBeenCalledOnce()
    resolveSnapshot?.(valid)
    await expect(firstRepair).resolves.toBe(true)
    await expect(secondRepair).resolves.toBe(true)
    expect(streams).toHaveLength(1)
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      failure: null,
      projection: { repair: { required: false } },
    })
    controller.close()
  })

  it("requires live idle authority and synchronously owns one browser command slot", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async () => {
      throw new TypeError("response lost")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => {
      throw new TypeError("receipt unavailable")
    })
    const { client, streams } = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => initial),
      submitMessage,
      getCommandReceipt,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: initial.session.project_ref,
    })

    await controller.open(initial.session.session_id)
    streams[0]?.onConnection({ kind: "reconnecting" })
    await expect(controller.submit("offline mutation")).resolves.toBe(false)
    expect(submitMessage).not.toHaveBeenCalled()

    streams[0]?.onConnection({ kind: "live" })
    const first = controller.submit("first")
    const second = controller.submit("second")
    await expect(Promise.all([first, second])).resolves.toEqual([false, false])
    expect(submitMessage).toHaveBeenCalledOnce()
    controller.close()
  })

  it("keeps the command slot pending while model selection changes during post-effect refresh", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const refreshed = snapshot("branch-original-12345678", "signed.cursor.2", "2")
    let resolveRefresh: ((value: SessionSnapshot | null) => void) | undefined
    const fetchSnapshot = vi.fn<SessionClient["fetchSnapshot"]>(() => new Promise((resolve) => {
      resolveRefresh = (value) => resolve(value)
    }))
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async (_sessionId, body) =>
      acceptedRunLaunch(body.command))
    const { client } = clientFixture({ initial, fetchSnapshot, submitMessage })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-default-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-default-12345678",
          optionKey: "default",
          label: "Default",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: ["low"],
          badges: [],
          availability: "available",
        }, {
          modelOptionRevisionRef: "model-option-deep-12345678",
          optionKey: "deep",
          label: "Deep",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: ["medium", "high"],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: initial.session.project_ref,
    })
    await controller.open(initial.session.session_id)

    const pending = controller.submit("first")
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    expect(controller.getSnapshot().projection.command.state).toBe("pending")

    controller.selectModelOption("model-option-deep-12345678")
    controller.selectEffort("high")

    expect(controller.getSnapshot()).toMatchObject({
      selectedModelOptionRevisionRef: "model-option-deep-12345678",
      selectedEffort: "high",
      projection: { command: { state: "pending" } },
    })
    await expect(controller.submit("must stay blocked")).resolves.toBe(false)
    expect(submitMessage).toHaveBeenCalledOnce()

    resolveRefresh?.(refreshed)
    await expect(pending).resolves.toBe(true)
    expect(controller.getSnapshot().projection.command.state).toBe("idle")

    const missingAuthority = controller.submit("second")
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledTimes(2))
    resolveRefresh?.(null)
    await expect(missingAuthority).resolves.toBe(false)
    expect(controller.getSnapshot()).toMatchObject({
      failure: { code: "SNAPSHOT_REQUIRED", action: "refetch_snapshot" },
      projection: { command: { state: "failed" } },
    })
    controller.selectModelOption("model-option-default-12345678")
    expect(controller.getSnapshot()).toMatchObject({
      failure: { code: "SNAPSHOT_REQUIRED", action: "refetch_snapshot" },
      projection: { command: { state: "failed" } },
    })
    controller.close()
  })

  it("single-flights concurrent creation and makes close permanently terminal", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const hydrate = vi.fn<SessionClient["hydrate"]>(async () => ({
      kind: "ready",
      snapshot: initial,
      watermark: initial.snapshot_watermark,
      cursor: initial.snapshot_watermark.cursor as SessionCursor,
    }))
    const createSession = vi.fn<SessionClient["createSession"]>(async (body) =>
      appliedSessionCreation(body.command, "standard"))
    const submitMessage = vi.fn<SessionClient["submitMessage"]>()
    const { client } = clientFixture({
      initial,
      hydrate,
      fetchSnapshot: vi.fn(async () => initial),
      createSession,
      submitMessage,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: initial.session.project_ref,
    })

    const first = controller.create("standard")
    const second = controller.create("standard")
    await Promise.all([first, second])
    expect(createSession).toHaveBeenCalledOnce()

    controller.close()
    await expect(controller.submit("after close")).resolves.toBe(false)
    await expect(controller.create("standard")).resolves.toBeNull()
    await controller.open(initial.session.session_id)
    expect(createSession).toHaveBeenCalledOnce()
    expect(submitMessage).not.toHaveBeenCalled()
    expect(hydrate).toHaveBeenCalledOnce()
  })

  it("marks repair immediately, aborts the request on close, and fully resets a missing owner", async () => {
    const initial = withAssistantText(
      snapshot("branch-original-12345678", "signed.cursor.1", "1"),
      "sensitive projection",
    )
    let resolveRepair: ((value: SessionSnapshot | null) => void) | undefined
    let repairSignal: AbortSignal | undefined
    const fetchSnapshot = vi.fn<SessionClient["fetchSnapshot"]>((_sessionId, requestOptions) => {
      repairSignal = requestOptions?.signal
      return new Promise((resolve) => {
        resolveRepair = resolve
      })
    })
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: initial.session.project_ref,
    })

    await controller.open(initial.session.session_id)
    streams[0]?.onConnection({ kind: "repair_required", recovery: { kind: "rehydrate", reason: "cursor_expired" } })
    expect(controller.getSnapshot().projection).toMatchObject({
      connection: { kind: "reconnecting" },
      repair: { required: true, reason: "snapshot_repair_in_progress" },
    })
    expect(repairSignal).toBeInstanceOf(AbortSignal)
    controller.close()
    expect(repairSignal?.aborted).toBe(true)

    const missingFetch = vi.fn<SessionClient["fetchSnapshot"]>(async () => null)
    const secondFixture = clientFixture({ initial, fetchSnapshot: missingFetch })
    const missing = createChatController({
      client: secondFixture.client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: initial.session.project_ref,
    })
    await missing.open(initial.session.session_id)
    secondFixture.streams[0]?.onConnection({ kind: "repair_required", recovery: { kind: "rehydrate", reason: "cursor_expired" } })
    await vi.waitFor(() => expect(missing.getSnapshot().phase).toBe("not_found"))
    expect(missing.getSnapshot()).toMatchObject({
      sessionId: null,
      projection: { session: null, messages: [], branches: [] },
      selectedModelOptionRevisionRef: null,
      selectedEffort: null,
      appliedDraft: null,
    })
    resolveRepair?.(null)
    missing.close()
  })

  it("aborts superseded hydration when a different Session is opened", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    let firstSignal: AbortSignal | undefined
    const hydrate = vi.fn<SessionClient["hydrate"]>((sessionId, requestOptions) => {
      if (sessionId === initial.session.session_id) {
        return Promise.resolve({
          kind: "ready",
          snapshot: initial,
          watermark: initial.snapshot_watermark,
          cursor: initial.snapshot_watermark.cursor as SessionCursor,
        })
      }
      firstSignal = requestOptions?.signal
      return new Promise((resolve) => {
        requestOptions?.signal?.addEventListener("abort", () => resolve({ kind: "not_found" }), { once: true })
      })
    })
    const { client } = clientFixture({ initial, hydrate, fetchSnapshot: vi.fn(async () => initial) })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: initial.session.project_ref,
    })

    const superseded = controller.open("session-superseded-12345678")
    await vi.waitFor(() => expect(firstSignal).toBeInstanceOf(AbortSignal))
    await controller.open(initial.session.session_id)
    await superseded

    expect(firstSignal?.aborted).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      sessionId: initial.session.session_id,
      projection: { session: { id: initial.session.session_id } },
    })
    controller.close()
  })

  it("re-resolves HITL identities and rejects terminal parts instead of trusting caller envelopes", async () => {
    const base = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const messageId = "message-assistant-12345678"
    const runId = "run-12345678"
    const initial: SessionSnapshot = {
      ...base,
      session: { ...base.session, active_leaf_message_id: messageId },
      branches: [{ ...base.branches[0]!, root_message_id: messageId, leaf_message_id: messageId }],
      messages: [{
        message_id: messageId,
        branch_id: base.session.active_branch_id,
        role: "assistant",
        ordinal: 0,
        run_id: runId,
        lifecycle: "streaming",
        parts: [{
          part_id: "approval-part-12345678",
          message_id: messageId,
          ordinal: 0,
          version: 2,
          schema_version: 1,
          lifecycle: "completed",
          kind: "approval",
          payload: {
            owner_ref: "approval-owner-12345678",
            expected_version: 2,
            decision_group_ref: "decision-group-12345678",
            required_owner_refs: ["approval-owner-12345678"],
            title: "Already applied",
            description: "This decision is terminal",
            allowed_actions: ["approve", "reject"],
            status: "applied",
          },
        }, {
          part_id: "plan-part-12345678",
          message_id: messageId,
          ordinal: 1,
          version: 2,
          schema_version: 1,
          lifecycle: "completed",
          kind: "plan",
          payload: {
            plan_proposal_ref: "plan-proposal-12345678",
            plan_version: 2,
            summary: "Already accepted",
            steps: [],
            allowed_actions: ["accept", "reject"],
            status: "accepted",
          },
        }],
        attachments: [],
        created_at: NOW,
      }],
      runs: [{
        run_id: runId,
        launch_id: "launch-12345678",
        branch_id: base.session.active_branch_id,
        assistant_message_id: messageId,
        execution_status: "paused",
        cost_status: "committed",
        last_durable_cursor: base.snapshot_watermark.cursor,
        projection_version: 2,
      }],
      run_launches: [{
        launch_id: "launch-12345678",
        branch_id: base.session.active_branch_id,
        trigger_message_id: messageId,
        proposed_run_id: runId,
        status: "event_observed",
        command_receipt_ref: "receipt-launch-12345678",
        version: 2,
        updated_at: NOW,
      }],
    }

    for (const kind of ["action", "plan"] as const) {
      const decideAction = vi.fn<SessionClient["decideAction"]>()
      const decidePlan = vi.fn<SessionClient["decidePlan"]>()
      const { client } = clientFixture({
        initial,
        fetchSnapshot: vi.fn(async () => initial),
        decideAction,
        decidePlan,
      })
      const controller = createChatController({
        client,
        trustedLocale: "en-US",
        chatCatalog: null,
        defaultProjectRef: initial.session.project_ref,
      })
      await controller.open(initial.session.session_id)
      if (kind === "action") {
        await controller.decideAction({
          runId,
          partId: "approval-part-12345678",
          decision: { kind: "approve", payload: { acknowledged_risk: true } },
        })
      } else {
        await controller.decidePlan({
          runId,
          partId: "plan-part-12345678",
          decision: { kind: "accept", payload: {} },
        })
      }
      expect(decideAction).not.toHaveBeenCalled()
      expect(decidePlan).not.toHaveBeenCalled()
      controller.close()
    }
  })

  it("binds edit and interaction schema refs to the current HITL projection", async () => {
    const base = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const messageId = "message-assistant-12345678"
    const runId = "run-12345678"
    const schemaRef = "schema-authoritative-12345678"
    const initial: SessionSnapshot = {
      ...base,
      session: { ...base.session, active_leaf_message_id: messageId },
      branches: [{ ...base.branches[0]!, root_message_id: messageId, leaf_message_id: messageId }],
      messages: [{
        message_id: messageId,
        branch_id: base.session.active_branch_id,
        role: "assistant",
        ordinal: 0,
        run_id: runId,
        lifecycle: "streaming",
        parts: [{
          part_id: "interaction-part-12345678",
          message_id: messageId,
          ordinal: 0,
          version: 1,
          schema_version: 1,
          lifecycle: "streaming",
          kind: "interaction",
          payload: {
            owner_ref: "interaction-owner-12345678",
            expected_version: 1,
            decision_group_ref: "decision-group-12345678",
            required_owner_refs: ["interaction-owner-12345678"],
            title: "Respond",
            description: "Provide an answer",
            input_schema_ref: schemaRef,
            safe_input_schema: { kind: "text", max_length: 128 },
            allowed_actions: ["edit", "respond"],
            status: "pending",
          },
        }],
        attachments: [],
        created_at: NOW,
      }],
      run_launches: [{
        launch_id: "launch-12345678",
        branch_id: base.session.active_branch_id,
        trigger_message_id: messageId,
        proposed_run_id: runId,
        status: "event_observed",
        command_receipt_ref: "receipt-launch-12345678",
        version: 1,
        updated_at: NOW,
      }],
      runs: [{
        run_id: runId,
        launch_id: "launch-12345678",
        branch_id: base.session.active_branch_id,
        assistant_message_id: messageId,
        execution_status: "paused",
        cost_status: "committed",
        last_durable_cursor: base.snapshot_watermark.cursor,
        projection_version: 1,
      }],
    }

    const mismatchedDecision = vi.fn<SessionClient["decideAction"]>()
    const mismatchFixture = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => initial),
      decideAction: mismatchedDecision,
    })
    const mismatch = createChatController({
      client: mismatchFixture.client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: initial.session.project_ref,
    })
    await mismatch.open(initial.session.session_id)
    await mismatch.decideAction({
      runId,
      partId: "interaction-part-12345678",
      decision: {
        kind: "respond",
        payload: {
          input_schema_ref: "schema-caller-controlled-12345678",
          response: { kind: "text", payload: { text: "hello" } },
        },
      },
    })
    expect(mismatchedDecision).not.toHaveBeenCalled()
    expect(mismatch.getSnapshot().failure).toMatchObject({ code: "ACTION_NOT_ALLOWED", action: "refetch_snapshot" })
    mismatch.close()

    const decideAction = vi.fn<SessionClient["decideAction"]>(async () => {
      throw new TypeError("stop after request capture")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => {
      throw new TypeError("receipt unavailable")
    })
    const matchingFixture = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => initial),
      decideAction,
      getCommandReceipt,
    })
    const matching = createChatController({
      client: matchingFixture.client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: initial.session.project_ref,
    })
    await matching.open(initial.session.session_id)
    await matching.decideAction({
      runId,
      partId: "interaction-part-12345678",
      decision: {
        kind: "edit",
        payload: { input_schema_ref: schemaRef, edited_input: { safe: true } },
      },
    })
    expect(decideAction).toHaveBeenCalledOnce()
    expect(decideAction.mock.calls[0]?.[2].decision).toEqual({
      kind: "edit",
      payload: { input_schema_ref: schemaRef, edited_input: { safe: true } },
    })
    matching.close()
  })

  it("exposes one projection authority for live session and branch metadata", async () => {
    const initial: SessionSnapshot = {
      ...snapshot("branch-original-12345678", "signed.cursor.1", "1", "standard"),
      branches: [{
        branch_id: "branch-original-12345678",
        origin: "original",
        version: 1,
        created_at: NOW,
      }],
    }
    const { client, streams } = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => initial),
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open(initial.session.session_id)
    expect("snapshot" in controller.getSnapshot()).toBe(false)
    expect(controller.getSnapshot().projection).toMatchObject({
      session: { title: "Recovery", contextPolicy: "standard" },
      branches: [{ id: "branch-original-12345678", origin: "original" }],
      snapshotRevision: "signed.cursor.1",
    })

    streams[0]?.onEvent({
      ...sessionUpdated("standard"),
      payload: {
        session: {
          ...initial.session,
          title: "Renamed live",
          version: 2,
        },
      },
    }, "signed.cursor.2" as SessionCursor)
    expect(controller.getSnapshot().projection.session).toMatchObject({
      title: "Renamed live",
      contextPolicy: "standard",
      version: 2,
    })

    streams[0]?.onEvent(branchCreated("branch-fork-12345678"), "signed.cursor.3" as SessionCursor)
    expect(controller.getSnapshot().projection.branches).toEqual([
      expect.objectContaining({ id: "branch-original-12345678", origin: "original" }),
      expect.objectContaining({ id: "branch-fork-12345678", origin: "fork" }),
    ])
    controller.close()
  })

  it("builds edit attachment intents from the projection instead of a retained Session snapshot", async () => {
    const base = snapshot("branch-original-12345678", "signed.cursor.1", "1", "standard")
    const message = {
      message_id: "message-user-12345678",
      branch_id: "branch-original-12345678",
      role: "user" as const,
      ordinal: 0,
      lifecycle: "completed" as const,
      parts: [{
        part_id: "part-user-12345678",
        message_id: "message-user-12345678",
        ordinal: 0,
        version: 1,
        schema_version: 1 as const,
        lifecycle: "completed" as const,
        kind: "text" as const,
        payload: { spans: [{ text: "original" }] },
      }],
      attachments: [{
        ordinal: 0,
        asset_ref: "asset-12345678",
        asset_version_ref: "asset-version-12345678",
        asset_grant_ref: "asset-grant-12345678",
        readiness: "ready",
        media_type: "image/png",
        display_name: "source.png",
        size_bytes: 1024,
      }],
      created_at: NOW,
    }
    const initial: SessionSnapshot = {
      ...base,
      session: { ...base.session, active_leaf_message_id: message.message_id },
      branches: [{ ...base.branches[0]!, root_message_id: message.message_id, leaf_message_id: message.message_id }],
      messages: [message],
    }
    const refreshed: SessionSnapshot = {
      ...initial,
      session: { ...initial.session, version: 2 },
      branches: [{ ...initial.branches[0]!, version: 2 }],
      snapshot_watermark: {
        ...initial.snapshot_watermark,
        cursor: "signed.cursor.2",
        durable_seq: "2",
        projection_version: 2,
      },
    }
    const editMessage = vi.fn<SessionClient["editMessage"]>(async (_sessionId, _messageId, body) => ({
      command_receipt: {
        operation: "edit_message",
        command_id: body.command.command_id,
        idempotency_key: body.command.idempotency_key,
        digest_algorithm: body.command.digest_algorithm,
        request_digest: body.command.request_digest,
        updated_at: NOW,
        status: "accepted",
        payload: {
          kind: "run-launch-created",
          payload: {
            session_id: initial.session.session_id,
            branch_id: "branch-edit-12345678",
            trigger_message_id: "message-user-edited-12345678",
            assistant_message_id: "message-assistant-edited-12345678",
            launch_id: "launch-edit-12345678",
            proposed_run_id: "run-edit-12345678",
            session_version: 2,
            branch_version: 1,
          },
        },
      },
    }))
    const { client } = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => refreshed),
      editMessage,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: "project-12345678",
    })

    await controller.open(initial.session.session_id)
    await expect(controller.editMessage(message.message_id, "replacement")).resolves.toBe(true)

    expect(editMessage).toHaveBeenCalledWith(initial.session.session_id, message.message_id, expect.objectContaining({
      expected_session_version: 1,
      expected_branch_version: 1,
      replacement_attachment_refs: [{
        asset_ref: "asset-12345678",
        asset_version_ref: "asset-version-12345678",
        asset_grant_ref: "asset-grant-12345678",
      }],
    }))
    controller.close()
  })

  it("creates a temporary Session only when the receipt and owner snapshot confirm the requested policy", async () => {
    const temporary = snapshot("branch-temporary-12345678", "signed.cursor.1", "1", "temporary")
    const createSession = vi.fn<SessionClient["createSession"]>(async (body) => ({
      command_receipt: {
        operation: "create_session",
        command_id: body.command.command_id,
        idempotency_key: body.command.idempotency_key,
        digest_algorithm: body.command.digest_algorithm,
        request_digest: body.command.request_digest,
        updated_at: NOW,
        status: "applied",
        payload: {
          kind: "session-created",
          payload: {
            session_id: temporary.session.session_id,
            initial_branch_id: temporary.session.active_branch_id,
            session_version: temporary.session.version,
            context_policy: "temporary",
          },
        },
      },
    }))
    const { client } = clientFixture({
      initial: temporary,
      createSession,
      fetchSnapshot: vi.fn(async () => temporary),
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await expect(controller.create("temporary")).resolves.toBe(temporary.session.session_id)

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      project_ref: "project-12345678",
      context_policy: "temporary",
    }))
    expect(controller.getSnapshot().projection.session?.contextPolicy).toBe("temporary")
    controller.close()
  })

  it.each([
    {
      caseName: "network failure",
      hydrate: vi.fn<SessionClient["hydrate"]>(async () => {
        throw new SessionClientError("network", "offline")
      }),
      expectedPhase: "loading" as const,
      expectedFailure: { code: "INTERNAL_UNAVAILABLE", action: "refetch_snapshot" },
    },
    {
      caseName: "not found",
      hydrate: vi.fn<SessionClient["hydrate"]>(async () => ({ kind: "not_found" })),
      expectedPhase: "not_found" as const,
      expectedFailure: null,
    },
    {
      caseName: "snapshot repair",
      hydrate: vi.fn<SessionClient["hydrate"]>(async () => ({
        kind: "repair_required",
        snapshot: snapshot("branch-temporary-12345678", "signed.cursor.1", "1", "temporary"),
        reason: "cursor rejected",
      })),
      expectedPhase: "loading" as const,
      expectedFailure: { code: "INTERNAL_UNAVAILABLE", action: "refetch_snapshot" },
    },
  ])("keeps the applied creation identity when first hydration ends in $caseName", async ({ hydrate, expectedPhase, expectedFailure }) => {
    const temporary = snapshot("branch-temporary-12345678", "signed.cursor.1", "1", "temporary")
    const createSession = vi.fn<SessionClient["createSession"]>(async (body) =>
      appliedSessionCreation(body.command, "temporary"))
    const { client } = clientFixture({
      initial: temporary,
      createSession,
      fetchSnapshot: vi.fn(async () => temporary),
      hydrate,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await expect(controller.create("temporary")).resolves.toBe("session-12345678")

    expect(controller.getSnapshot()).toMatchObject({
      phase: expectedPhase,
      sessionId: "session-12345678",
      failure: expectedFailure,
    })
    controller.close()
  })

  it("does not persist command recovery for a temporary Session", async () => {
    const temporary = snapshot("branch-temporary-12345678", "signed.cursor.1", "1", "temporary")
    const recoveryStore = {
      load: () => null,
      save: vi.fn(),
      clear: vi.fn(),
    } satisfies SessionCommandRecoveryStore
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async () => {
      throw new TypeError("response lost")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => {
      throw new TypeError("receipt temporarily unavailable")
    })
    const { client } = clientFixture({
      initial: temporary,
      fetchSnapshot: vi.fn(async () => temporary),
      getCommandReceipt,
      submitMessage,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: "project-12345678",
      commandRecoveryStore: recoveryStore,
    })

    await controller.open(temporary.session.session_id)
    await expect(controller.submit("temporary content")).resolves.toBe(false)

    expect(submitMessage).toHaveBeenCalledOnce()
    expect(getCommandReceipt).toHaveBeenCalledOnce()
    expect(recoveryStore.save).not.toHaveBeenCalled()
    controller.close()
  })

  it("defers an unrelated standard recovery record while an exact temporary Session is open", async () => {
    const temporary = snapshot("branch-temporary-12345678", "signed.cursor.1", "1", "temporary")
    const persisted: SessionCommandRecoveryRecord = {
      schemaVersion: 1,
      operation: "submit_message",
      command: {
        command_id: "command-standard-12345678",
        idempotency_key: "web:command-standard-12345678",
        digest_algorithm: "SHA256_CANONICAL_JSON_V2",
        request_digest: "a".repeat(64),
      },
      sessionId: "session-standard-12345678",
      clientDraftRevision: "draft-standard-12345678",
      createdAt: 1_000,
    }
    const recoveryStore = {
      load: vi.fn(() => persisted),
      save: vi.fn(),
      clear: vi.fn(),
    } satisfies SessionCommandRecoveryStore
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async () => {
      throw new TypeError("response lost")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => {
      throw new TypeError("receipt temporarily unavailable")
    })
    const { client } = clientFixture({
      initial: temporary,
      fetchSnapshot: vi.fn(async () => temporary),
      getCommandReceipt,
      submitMessage,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: "project-12345678",
      commandRecoveryStore: recoveryStore,
    })

    await controller.open(temporary.session.session_id)
    await expect(controller.resumePendingCommand()).resolves.toBe(false)
    await expect(controller.submit("temporary content")).resolves.toBe(false)

    expect(submitMessage).toHaveBeenCalledOnce()
    expect(getCommandReceipt).toHaveBeenCalledOnce()
    expect(recoveryStore.save).not.toHaveBeenCalled()
    expect(recoveryStore.clear).not.toHaveBeenCalled()
    controller.close()
  })

  it("reconciles an ambiguous temporary mutation in memory with the exact command identity", async () => {
    const temporary = snapshot("branch-temporary-12345678", "signed.cursor.1", "1", "temporary")
    const refreshed = snapshot("branch-temporary-12345678", "signed.cursor.2", "2", "temporary")
    const recoveryStore = {
      load: () => null,
      save: vi.fn(),
      clear: vi.fn(),
    } satisfies SessionCommandRecoveryStore
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async () => {
      throw new TypeError("response lost")
    })
    let submittedCommand: SessionCommandRecoveryRecord["command"] | null = null
    submitMessage.mockImplementationOnce(async (_sessionId, body) => {
      submittedCommand = body.command
      throw new TypeError("response lost")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>()
      .mockRejectedValueOnce(new TypeError("receipt temporarily unavailable"))
      .mockImplementationOnce(async () => {
        if (submittedCommand === null) throw new Error("missing submitted command")
        return acceptedRunLaunch(submittedCommand)
      })
    const fetchSnapshot = vi.fn(async () => refreshed)
    const { client } = clientFixture({ initial: temporary, fetchSnapshot, getCommandReceipt, submitMessage })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: "project-12345678",
      commandRecoveryStore: recoveryStore,
    })

    await controller.open(temporary.session.session_id)
    await expect(controller.submit("temporary content")).resolves.toBe(false)
    await expect(controller.resumePendingCommand()).resolves.toBe(true)

    expect(getCommandReceipt).toHaveBeenNthCalledWith(2, submittedCommand?.command_id, {
      operation: "submit_message",
      idempotency_key: submittedCommand?.idempotency_key,
      digest_algorithm: submittedCommand?.digest_algorithm,
      request_digest: submittedCommand?.request_digest,
    })
    expect(controller.getSnapshot().projection.snapshotRevision).toBe(refreshed.snapshot_watermark.cursor)
    expect(recoveryStore.save).not.toHaveBeenCalled()
    expect(recoveryStore.clear).not.toHaveBeenCalled()
    controller.close()
  })

  it("fails closed when an owner event changes a Session context policy", async () => {
    const standard = withAssistantText(
      snapshot("branch-original-12345678", "signed.cursor.1", "1", "standard"),
      "sensitive plaintext",
    )
    const { client, streams, streamHandles } = clientFixture({
      initial: standard,
      fetchSnapshot: vi.fn(async () => standard),
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open(standard.session.session_id)
    streams[0]?.onEvent(sessionUpdated("temporary"), "signed.cursor.2" as SessionCursor)

    expect(streamHandles[0]?.close).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      phase: "not_found",
      sessionId: null,
      projection: { messages: [] },
      failure: { code: "CLIENT_CONTRACT_UPGRADE_REQUIRED", action: "upgrade_client" },
    })
    controller.close()
  })

  it("fails closed when snapshot repair changes a Session context policy", async () => {
    const standard = withAssistantText(
      snapshot("branch-original-12345678", "signed.cursor.1", "1", "standard"),
      "sensitive plaintext",
    )
    const drifted = snapshot("branch-original-12345678", "signed.cursor.2", "2", "temporary")
    const { client, streams, streamHandles } = clientFixture({
      initial: standard,
      fetchSnapshot: vi.fn(async () => drifted),
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open(standard.session.session_id)
    streams[0]?.onConnection({ kind: "repair_required", recovery: { kind: "rehydrate", reason: "cursor_expired" } })
    await vi.waitFor(() => expect(controller.getSnapshot().failure?.code).toBe("CLIENT_CONTRACT_UPGRADE_REQUIRED"))

    expect(streamHandles[0]?.close).toHaveBeenCalledOnce()
    expect(controller.getSnapshot()).toMatchObject({
      phase: "not_found",
      sessionId: null,
      projection: { messages: [] },
    })
    controller.close()
  })

  it("does not carry one conversation's model draft selection into another conversation", async () => {
    const first = withAssistantText(snapshot("branch-first-12345678", "signed.cursor.1", "1"), "first session")
    const secondBase: SessionSnapshot = {
      ...snapshot("branch-second-12345678", "signed.cursor.2", "2"),
      session: {
        ...snapshot("branch-second-12345678", "signed.cursor.2", "2").session,
        session_id: "session-second-12345678",
      },
      model_history: [{ model_option_revision_ref: "model-option-second-12345678", label: "Second" }],
    }
    const second = withAssistantText(secondBase, "second session")
    const hydrate = vi.fn<SessionClient["hydrate"]>(async (sessionId) => {
      const selected = sessionId === "session-second-12345678" ? second : first
      return {
        kind: "ready",
        snapshot: selected,
        watermark: selected.snapshot_watermark,
        cursor: selected.snapshot_watermark.cursor as SessionCursor,
      }
    })
    const { client } = clientFixture({ initial: first, fetchSnapshot: vi.fn(async () => first), hydrate })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-first-12345678",
        publishedAt: NOW,
        options: [
          { modelOptionRevisionRef: "model-option-first-12345678", optionKey: "first", label: "First", inputModalities: ["text"], outputModalities: ["text"], supportedEfforts: [], badges: [], availability: "available" },
          { modelOptionRevisionRef: "model-option-second-12345678", optionKey: "second", label: "Second", inputModalities: ["text"], outputModalities: ["text"], supportedEfforts: [], badges: [], availability: "available" },
        ],
      },
      defaultProjectRef: "project-12345678",
    })
    const published: ReturnType<typeof controller.getSnapshot>[] = []
    controller.subscribe(() => published.push(controller.getSnapshot()))

    await controller.open("session-12345678")
    expect(controller.getSnapshot().selectedModelOptionRevisionRef).toBe("model-option-first-12345678")
    expect(controller.getSnapshot().projection.messages[0]?.parts[0]).toMatchObject({ text: "first session" })
    await controller.open("session-second-12345678")
    expect(controller.getSnapshot().selectedModelOptionRevisionRef).toBe("model-option-second-12345678")
    expect(controller.getSnapshot().projection.messages[0]?.parts[0]).toMatchObject({ text: "second session" })
    expect(published.find((value) =>
      value.phase === "loading" && value.sessionId === "session-second-12345678",
    )?.projection).toMatchObject({ messages: [], connection: { kind: "connecting" } })
    expect(published.find((value) => value.projection.snapshotRevision === second.snapshot_watermark.cursor)?.projection.messages[0]?.parts[0])
      .toMatchObject({ text: "second session" })
    controller.close()
  })

  it("repairs a conflicting Run projection version instead of regressing visible state", async () => {
    const base = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const initial: SessionSnapshot = {
      ...base,
      run_launches: [{
        launch_id: "launch-12345678",
        branch_id: "branch-original-12345678",
        trigger_message_id: "message-trigger-12345678",
        proposed_run_id: "run-12345678",
        status: "event_observed",
        command_receipt_ref: "receipt-launch-12345678",
        version: 2,
        updated_at: NOW,
      }],
      runs: [{
        run_id: "run-12345678",
        launch_id: "launch-12345678",
        branch_id: "branch-original-12345678",
        assistant_message_id: "message-assistant-12345678",
        execution_status: "running",
        cost_status: "committed",
        last_durable_cursor: "signed.cursor.1",
        projection_version: 2,
      }],
    }
    const repaired: SessionSnapshot = {
      ...initial,
      runs: [{ ...initial.runs[0]!, execution_status: "completed", projection_version: 3 }],
      snapshot_watermark: { ...initial.snapshot_watermark, cursor: "signed.cursor.2", durable_seq: "2" },
    }
    const fetchSnapshot = vi.fn(async () => repaired)
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    streams[0]?.onEvent({
      kind: "run.view.updated",
      event_id: "event-conflict-12345678",
      cursor: "signed.cursor.2",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      durable_seq: "2",
      projection_version: 2,
      schema_revision: 3,
      recorded_at: NOW,
      payload: { run: { ...initial.runs[0]!, execution_status: "failed" } },
    }, "signed.cursor.2" as SessionCursor)

    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(controller.getSnapshot().projection.snapshotRevision).toBe(repaired.snapshot_watermark.cursor))
    expect(controller.getSnapshot().projection.activeRunId).toBeNull()
    controller.close()
  })

  it("repairs a projection-invalidating event from a fresh authoritative snapshot", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const repaired = snapshot("branch-repaired-12345678", "signed.cursor.2", "2")
    const fetchSnapshot = vi.fn(async () => repaired)
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    streams[0]?.onEvent(branchActivated("branch-repaired-12345678"), "signed.cursor.2" as SessionCursor)
    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(controller.getSnapshot().projection.snapshotRevision).toBe(repaired.snapshot_watermark.cursor))

    expect(streams).toHaveLength(2)
    expect(controller.getSnapshot().projection).toMatchObject({
      activeBranchId: "branch-repaired-12345678",
      repair: { required: false },
    })
    controller.close()
  })

  it("single-flights snapshot repair when a part update skips versions", async () => {
    const base = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const message = {
      message_id: "message-assistant-12345678",
      branch_id: "branch-original-12345678",
      role: "assistant" as const,
      ordinal: 0,
      run_id: "run-12345678",
      lifecycle: "streaming" as const,
      parts: [{
        part_id: "part-assistant-12345678",
        message_id: "message-assistant-12345678",
        ordinal: 0,
        version: 1,
        schema_version: 1 as const,
        lifecycle: "streaming" as const,
        kind: "text" as const,
        payload: { spans: [{ text: "hello" }] },
      }],
      attachments: [],
      created_at: NOW,
    }
    const initial: SessionSnapshot = {
      ...base,
      session: { ...base.session, active_leaf_message_id: message.message_id },
      branches: [{ ...base.branches[0]!, root_message_id: message.message_id, leaf_message_id: message.message_id }],
      messages: [message],
    }
    const repaired: SessionSnapshot = {
      ...initial,
      messages: [{
        ...message,
        parts: [{ ...message.parts[0]!, version: 3, lifecycle: "completed", payload: { spans: [{ text: "repaired" }] } }],
      }],
      snapshot_watermark: {
        ...initial.snapshot_watermark,
        cursor: "signed.cursor.3",
        durable_seq: "3",
        projection_version: 3,
      },
    }
    let resolveRepair: ((value: SessionSnapshot | null) => void) | undefined
    const repair = new Promise<SessionSnapshot | null>((resolve) => {
      resolveRepair = resolve
    })
    const fetchSnapshot = vi.fn(() => repair)
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    const gap: SessionEvent = {
      kind: "message.part.updated",
      event_id: "event-gap-12345678",
      cursor: "signed.cursor.2",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      durable_seq: "2",
      projection_version: 2,
      schema_revision: 3,
      recorded_at: NOW,
      payload: {
        part: { ...message.parts[0]!, version: 3, lifecycle: "completed", payload: { spans: [{ text: "skipped" }] } },
      },
    }
    streams[0]?.onEvent(gap, "signed.cursor.2" as SessionCursor)
    streams[0]?.onEvent(gap, "signed.cursor.2" as SessionCursor)

    await vi.waitFor(() => expect(fetchSnapshot).toHaveBeenCalledOnce())
    expect(streams).toHaveLength(1)
    expect(controller.getSnapshot().projection).toMatchObject({
      messages: [{ parts: [{ version: 1, text: "hello" }] }],
      repair: { required: true, reason: "part_version_gap" },
    })

    if (resolveRepair === undefined) throw new Error("repair resolver missing")
    resolveRepair(repaired)
    await vi.waitFor(() => expect(controller.getSnapshot().projection.snapshotRevision).toBe(repaired.snapshot_watermark.cursor))
    expect(fetchSnapshot).toHaveBeenCalledOnce()
    expect(streams).toHaveLength(2)
    expect(controller.getSnapshot().projection).toMatchObject({
      messages: [{ parts: [{ version: 3, text: "repaired" }] }],
      repair: { required: false },
    })

    const repairedProjection = controller.getSnapshot().projection
    streams[1]?.onEvent({
      kind: "message.part.updated",
      event_id: "event-exact-replay-12345678",
      cursor: "signed.cursor.4",
      session_id: "session-12345678",
      stream_epoch: "epoch-12345678",
      durable_seq: "4",
      projection_version: 4,
      schema_revision: 3,
      recorded_at: NOW,
      payload: { part: repaired.messages[0]!.parts[0]! },
    }, "signed.cursor.4" as SessionCursor)
    await Promise.resolve()
    expect(fetchSnapshot).toHaveBeenCalledOnce()
    expect(controller.getSnapshot().projection).toBe(repairedProjection)
    controller.close()
  })

  it("keeps a safe retry action when snapshot repair is temporarily unavailable", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const repaired = snapshot("branch-repaired-12345678", "signed.cursor.2", "2")
    const fetchSnapshot = vi.fn<SessionClient["fetchSnapshot"]>()
      .mockRejectedValueOnce(new SessionClientError("network", "offline"))
      .mockResolvedValueOnce(repaired)
    const { client, streams } = clientFixture({ initial, fetchSnapshot })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    streams[0]?.onConnection({ kind: "repair_required", recovery: { kind: "rehydrate", reason: "cursor_expired" } })
    await vi.waitFor(() => expect(controller.getSnapshot().failure).toMatchObject({
      code: "INTERNAL_UNAVAILABLE",
      action: "refetch_snapshot",
      retryClass: "after_delay",
    }))

    await expect(controller.recover()).resolves.toBe(true)
    expect(controller.getSnapshot().projection.snapshotRevision).toBe(repaired.snapshot_watermark.cursor)
    expect(controller.getSnapshot().failure).toBeNull()
    controller.close()
  })

  it("resumes only the exact durable receipt after a browser refresh", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const refreshed = snapshot("branch-original-12345678", "signed.cursor.2", "2")
    const record: SessionCommandRecoveryRecord = {
      schemaVersion: 1,
      operation: "submit_message",
      command: {
        command_id: "command-12345678",
        idempotency_key: "web:command-12345678",
        digest_algorithm: "SHA256_CANONICAL_JSON_V2",
        request_digest: "a".repeat(64),
      },
      sessionId: "session-12345678",
      clientDraftRevision: "draft-revision-12345678",
      createdAt: 1_000,
    }
    const clear = vi.fn()
    const recoveryStore = {
      load: () => record,
      save: vi.fn(),
      clear,
    } satisfies SessionCommandRecoveryStore
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => ({
      command_receipt: {
        operation: "submit_message",
        command_id: record.command.command_id,
        idempotency_key: record.command.idempotency_key,
        digest_algorithm: record.command.digest_algorithm,
        request_digest: record.command.request_digest,
        updated_at: NOW,
        status: "accepted",
        payload: {
          kind: "run-launch-created",
          payload: {
            session_id: "session-12345678",
            branch_id: "branch-original-12345678",
            trigger_message_id: "message-user-12345678",
            assistant_message_id: "message-assistant-12345678",
            launch_id: "launch-12345678",
            proposed_run_id: "run-12345678",
            session_version: 2,
            branch_version: 2,
          },
        },
      },
    }))
    const fetchSnapshot = vi.fn(async () => refreshed)
    const { client } = clientFixture({ initial, fetchSnapshot, getCommandReceipt })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: null,
      defaultProjectRef: "project-12345678",
      commandRecoveryStore: recoveryStore,
    })

    await controller.open("session-12345678")
    await expect(controller.resumePendingCommand()).resolves.toBe(true)

    expect(getCommandReceipt).toHaveBeenCalledWith(record.command.command_id, {
      operation: record.operation,
      idempotency_key: record.command.idempotency_key,
      digest_algorithm: record.command.digest_algorithm,
      request_digest: record.command.request_digest,
    })
    expect(clear).toHaveBeenCalledWith(record.command.command_id)
    expect(controller.getSnapshot().projection.snapshotRevision).toBe(refreshed.snapshot_watermark.cursor)
    expect(controller.getSnapshot().appliedDraft).toEqual({
      sessionId: "session-12345678",
      revision: "draft-revision-12345678",
    })
    controller.close()
  })

  it("persists the receipt identity before dispatch and retains it after an ambiguous response", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const save = vi.fn()
    const clear = vi.fn()
    const recoveryStore = {
      load: () => null,
      save,
      clear,
    } satisfies SessionCommandRecoveryStore
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async () => {
      throw new TypeError("response lost")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => {
      throw new TypeError("receipt temporarily unavailable")
    })
    const { client } = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => initial),
      getCommandReceipt,
      submitMessage,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: "project-12345678",
      commandRecoveryStore: recoveryStore,
    })

    await controller.open("session-12345678")
    await expect(controller.submit("hello", [{
      asset_ref: "asset-12345678",
      asset_version_ref: "asset-version-12345678",
      asset_grant_ref: "grant-12345678",
    }])).resolves.toBe(false)

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: 1,
      operation: "submit_message",
      sessionId: "session-12345678",
      command: expect.objectContaining({ digest_algorithm: "SHA256_CANONICAL_JSON_V2" }),
    }))
    expect(submitMessage).toHaveBeenCalledOnce()
    expect(submitMessage).toHaveBeenCalledWith("session-12345678", expect.objectContaining({
      attachment_refs: [{
        asset_ref: "asset-12345678",
        asset_version_ref: "asset-version-12345678",
        asset_grant_ref: "grant-12345678",
      }],
    }))
    expect(getCommandReceipt).toHaveBeenCalledOnce()
    expect(clear).not.toHaveBeenCalled()
    expect(controller.getSnapshot().failure).toMatchObject({ action: "reconcile_receipt" })

    await expect(controller.submit("a new effect")).resolves.toBe(false)
    expect(save).toHaveBeenCalledOnce()
    expect(submitMessage).toHaveBeenCalledOnce()
    controller.close()
  })

  it("submits ready attachments without manufacturing an empty text part", async () => {
    const initial = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const submitMessage = vi.fn<SessionClient["submitMessage"]>(async () => {
      throw new TypeError("response lost")
    })
    const getCommandReceipt = vi.fn<SessionClient["getCommandReceipt"]>(async () => {
      throw new TypeError("receipt temporarily unavailable")
    })
    const { client } = clientFixture({
      initial,
      fetchSnapshot: vi.fn(async () => initial),
      getCommandReceipt,
      submitMessage,
    })
    const controller = createChatController({
      client,
      trustedLocale: "en-US",
      chatCatalog: {
        surfaceId: "chat",
        catalogRevisionRef: "catalog-12345678",
        defaultModelOptionRevisionRef: "model-option-12345678",
        publishedAt: NOW,
        options: [{
          modelOptionRevisionRef: "model-option-12345678",
          optionKey: "standard",
          label: "Standard",
          inputModalities: ["text", "image"],
          outputModalities: ["text"],
          supportedEfforts: [],
          badges: [],
          availability: "available",
        }],
      },
      defaultProjectRef: "project-12345678",
    })

    await controller.open("session-12345678")
    await expect(controller.submit("", [])).resolves.toBe(false)
    expect(submitMessage).not.toHaveBeenCalled()

    await expect(controller.submit("  ", [{
      asset_ref: "asset-12345678",
      asset_version_ref: "asset-version-12345678",
      asset_grant_ref: "grant-12345678",
    }])).resolves.toBe(false)

    expect(submitMessage).toHaveBeenCalledOnce()
    expect(submitMessage).toHaveBeenCalledWith("session-12345678", expect.objectContaining({
      parts: [],
      attachment_refs: [{
        asset_ref: "asset-12345678",
        asset_version_ref: "asset-version-12345678",
        asset_grant_ref: "grant-12345678",
      }],
    }))
    expect(getCommandReceipt).toHaveBeenCalledOnce()
    controller.close()
  })
})
