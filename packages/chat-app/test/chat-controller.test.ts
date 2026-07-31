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
    branches: [],
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
    editMessage: unavailable,
    regenerateMessage: unavailable,
    forkBranch: unavailable,
    activateBranch: unavailable,
    cancelRun: unavailable,
    decideAction: unavailable,
    decidePlan: unavailable,
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
    expect(controller.getSnapshot().snapshot?.session.context_policy).toBe("temporary")
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
    expect(controller.getSnapshot().snapshot).toBe(refreshed)
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
      snapshot: null,
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
      snapshot: null,
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
    expect(published.find((value) => value.snapshot === second)?.projection.messages[0]?.parts[0])
      .toMatchObject({ text: "second session" })
    controller.close()
  })

  it("repairs a conflicting Run projection version instead of regressing visible state", async () => {
    const base = snapshot("branch-original-12345678", "signed.cursor.1", "1")
    const initial: SessionSnapshot = {
      ...base,
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
    await vi.waitFor(() => expect(controller.getSnapshot().snapshot).toBe(repaired))
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
    await vi.waitFor(() => expect(controller.getSnapshot().snapshot).toBe(repaired))

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
    await vi.waitFor(() => expect(controller.getSnapshot().snapshot).toBe(repaired))
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
    expect(controller.getSnapshot().snapshot).toBe(repaired)
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
    expect(controller.getSnapshot().snapshot).toBe(refreshed)
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
