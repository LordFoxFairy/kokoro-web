import {
  SessionClientError,
  type EventStreamHandle,
  type SessionClient,
} from "@kokoro/session-client"
import type {
  ActionDecision,
  AttachmentIntent,
  BrowserCommandOperation,
  CommandIdentity,
  ErrorDetail,
  MessageInputPart,
  PlanDecision,
  SessionCommandResponse,
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"
import {
  createChatProjectionStore,
  type ChatPart,
  type ChatProjection,
  type ChatProjectionMutation,
} from "@kokoro/chat-surface"

import {
  createCommandIdentity,
  reconcileCommandReceipt,
} from "./command"
import type {
  SessionCommandRecoveryRecord,
  SessionCommandRecoveryStore,
} from "./command-recovery"
import { createSessionContextCoordinator } from "./session-context-coordinator"
import type { SessionContextPolicy } from "./session-context-policy"

const commandIdentity = createCommandIdentity

export type ModelOption = Readonly<{
  modelOptionRevisionRef: string
  optionKey: string
  label: string
  description?: string
  inputModalities: readonly string[]
  outputModalities: readonly string[]
  supportedEfforts: readonly string[]
  badges: readonly string[]
  availability: "available" | "temporarily_unavailable"
}>

export type ModelOptionCatalog = Readonly<{
  surfaceId: string
  catalogRevisionRef: string
  defaultModelOptionRevisionRef: string
  options: readonly ModelOption[]
  publishedAt: string
}>

type StableCode = ErrorDetail["code"]
type StableAction = ErrorDetail["action"]
type RetryClass = ErrorDetail["retry_class"]

export type ChatFailure = Readonly<{
  code: StableCode
  action: StableAction
  retryClass: RetryClass
  message: string
}>

export type ChatState = Readonly<{
  phase: "idle" | "loading" | "ready" | "not_found"
  sessionId: string | null
  projection: ChatProjection
  failure: ChatFailure | null
  chatCatalog: ModelOptionCatalog | null
  selectedModelOptionRevisionRef: string | null
  selectedEffort: string | null
  appliedDraft: Readonly<{ sessionId: string; revision: string }> | null
  hitlDecisionSupported: true
}>

type FailureLike = Readonly<{
  stableCode?: StableCode
  action?: StableAction
  retryClass?: RetryClass
}>

const FAILURE_COPY: Partial<Record<StableCode, string>> = {
  SESSION_SCOPE_MISMATCH: "This session is not available in the current product context.",
  SESSION_ACCESS_GRANT_REQUIRED: "Your session access needs to be refreshed.",
  SESSION_ACCESS_GRANT_EXPIRED: "Your session access expired. Sign in again to continue.",
  SESSION_ACCESS_GRANT_REVOKED: "Your session access was revoked.",
  MODEL_OPTION_UNAVAILABLE: "No published model option is available for this session.",
  ACTIVE_RUN_EXISTS: "The current response is still running. Your draft was kept for the next turn.",
  ATTACHMENT_NOT_READY: "One or more attachments are not ready. Your draft was kept.",
  ADMISSION_DENIED: "This run was not admitted.",
  ADMISSION_OUTCOME_UNKNOWN: "Run admission is still being reconciled.",
  RUN_OUTCOME_UNKNOWN: "The run outcome is still being reconciled.",
  CLIENT_CONTRACT_UPGRADE_REQUIRED: "This chat needs a compatible client before it can be opened safely.",
  INTERNAL_UNAVAILABLE: "Chat is temporarily unavailable.",
}

export function describeSessionFailure(input: FailureLike): ChatFailure {
  const code = input.stableCode ?? "INTERNAL_UNAVAILABLE"
  return {
    code,
    action: input.action ?? "stop",
    retryClass: input.retryClass ?? "never",
    message: FAILURE_COPY[code] ?? "The session request could not be completed.",
  }
}

function failureFromError(error: unknown): ChatFailure {
  if (!(error instanceof SessionClientError)) return describeSessionFailure({})
  if (error.stableCode !== undefined || error.action !== undefined || error.retryClass !== undefined) {
    return describeSessionFailure(error)
  }
  switch (error.kind) {
    case "network":
      return describeSessionFailure({
        stableCode: "INTERNAL_UNAVAILABLE",
        action: "refetch_snapshot",
        retryClass: "after_delay",
      })
    case "repair_required":
      return describeSessionFailure({
        stableCode: "INTERNAL_UNAVAILABLE",
        action: "refetch_snapshot",
        retryClass: "after_user_action",
      })
    case "auth_required":
      return describeSessionFailure({
        stableCode: "SESSION_ACCESS_GRANT_REQUIRED",
        action: "refresh_grant",
        retryClass: "after_user_action",
      })
    case "contract_incompatible":
      return describeSessionFailure({
        stableCode: "CLIENT_CONTRACT_UPGRADE_REQUIRED",
        action: "upgrade_client",
        retryClass: "after_user_action",
      })
    case "command_conflict":
      return describeSessionFailure({
        stableCode: "IDEMPOTENCY_CONFLICT",
        action: "reconcile_receipt",
        retryClass: "reconcile_receipt",
      })
    case "http":
    case "protocol":
      return describeSessionFailure({})
  }
}

function deniedFailure(response: SessionCommandResponse): ChatFailure | null {
  const receipt = response.command_receipt
  if (receipt.status === "denied") {
    return describeSessionFailure({
      stableCode: receipt.payload.code,
      action: receipt.payload.action,
      retryClass: receipt.payload.retry_class,
    })
  }
  if (receipt.status === "outcome_unknown") {
    return describeSessionFailure({
      stableCode: "RUN_OUTCOME_UNKNOWN",
      action: receipt.payload.action,
      retryClass: receipt.payload.retry_class,
    })
  }
  return null
}

export type ChatController = Readonly<{
  getSnapshot(): ChatState
  subscribe(listener: () => void): () => void
  create(contextPolicy: SessionContextPolicy): Promise<string | null>
  open(sessionId: string): Promise<void>
  submit(
    content: string,
    attachments?: readonly AttachmentIntent[],
    clientDraftRevision?: string,
  ): Promise<boolean>
  editMessage(messageId: string, content: string): Promise<boolean>
  regenerateMessage(messageId: string): Promise<boolean>
  forkBranch(branchId: string): Promise<boolean>
  activateBranch(branchId: string): Promise<boolean>
  cancel(): Promise<void>
  recover(): Promise<boolean>
  resumePendingCommand(): Promise<boolean>
  selectModelOption(modelOptionRevisionRef: string): void
  selectEffort(effort: string | null): void
  decideAction(input: Readonly<{
    runId: string
    part: Extract<ChatPart, { kind: "approval" | "interaction" }>
    decision: ActionDecision
  }>): Promise<void>
  decidePlan(input: Readonly<{
    runId: string
    part: Extract<ChatPart, { kind: "plan" }>
    decision: PlanDecision
  }>): Promise<void>
  close(): void
}>

export function createChatController(options: {
  readonly client: SessionClient
  readonly trustedLocale: string
  readonly chatCatalog: ModelOptionCatalog | null
  readonly defaultProjectRef: string | null
  readonly commandRecoveryStore?: SessionCommandRecoveryStore
}): ChatController {
  const projectionStore = createChatProjectionStore()
  let state: ChatState = {
    phase: "idle",
    sessionId: null,
    projection: projectionStore.getSnapshot(),
    failure: null,
    chatCatalog: options.chatCatalog,
    selectedModelOptionRevisionRef: null,
    selectedEffort: null,
    appliedDraft: null,
    hitlDecisionSupported: true,
  }
  let stream: EventStreamHandle | null = null
  let repairTask: Readonly<{ generation: number; task: Promise<boolean> }> | null = null
  const contextCoordinator = createSessionContextCoordinator({
    ...(options.commandRecoveryStore === undefined ? {} : { commandRecoveryStore: options.commandRecoveryStore }),
  })
  let generation = 0
  let selectionSessionId: string | null = null
  const listeners = new Set<() => void>()

  const publish = (next: ChatState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const project = (action: ChatProjectionMutation): void => {
    projectionStore.dispatch(action)
    publish({ ...state, projection: projectionStore.getSnapshot() })
  }
  const fail = (failure: ChatFailure): void => {
    publish({ ...state, failure })
    project({
      type: "command",
      state: failure.action === "reconcile_receipt" ? "conflict" : "failed",
      detail: failure.code,
    })
  }
  const failClosedForOwnerContract = (): void => {
    generation += 1
    repairTask = null
    const activeStream = stream
    stream = null
    activeStream?.close()
    projectionStore.reset()
    publish({
      ...state,
      phase: "not_found",
      sessionId: null,
      projection: projectionStore.getSnapshot(),
      failure: describeSessionFailure({
        stableCode: "CLIENT_CONTRACT_UPGRADE_REQUIRED",
        action: "upgrade_client",
        retryClass: "after_user_action",
      }),
    })
  }

  const observeOwnerPolicy = (
    sessionId: string,
    ownerSessionId: string,
    contextPolicy: SessionContextPolicy,
  ): boolean => {
    if (ownerSessionId !== sessionId || contextCoordinator.observe(sessionId, contextPolicy).kind === "mismatch") {
      failClosedForOwnerContract()
      return false
    }
    return true
  }

  const repairFromSnapshot = (expectedGeneration: number): Promise<boolean> => {
    if (repairTask?.generation === expectedGeneration) return repairTask.task
    const sessionId = state.sessionId
    if (sessionId === null) return Promise.resolve(false)

    const task = (async (): Promise<boolean> => {
      const activeStream = stream
      stream = null
      activeStream?.close()
      publish({ ...state, failure: null })
      project({ type: "connection", connection: { kind: "reconnecting" } })
      try {
        const snapshot = await options.client.fetchSnapshot(sessionId)
        if (expectedGeneration !== generation) return false
        if (snapshot === null) {
          publish({ ...state, phase: "not_found", failure: null })
          return false
        }
        return attach(sessionId, snapshot, expectedGeneration)
      } catch (error) {
        if (expectedGeneration === generation) fail(failureFromError(error))
        return false
      }
    })()
    const tracked = Object.freeze({ generation: expectedGeneration, task })
    repairTask = tracked
    void task.finally(() => {
      if (repairTask === tracked) repairTask = null
    })
    return task
  }

  const attach = (sessionId: string, snapshot: SessionSnapshot, currentGeneration: number): boolean => {
    if (!observeOwnerPolicy(sessionId, snapshot.session.session_id, snapshot.session.context_policy)) return false
    const previousStream = stream
    stream = null
    previousStream?.close()
    const availableOptions = new Set(
      options.chatCatalog?.options
        .filter(({ availability }) => availability === "available")
        .map(({ modelOptionRevisionRef }) => modelOptionRevisionRef) ?? [],
    )
    const persistedOption = snapshot.model_history.at(-1)?.model_option_revision_ref
    const selectedModelOptionRevisionRef =
      selectionSessionId === sessionId &&
      state.selectedModelOptionRevisionRef !== null &&
      availableOptions.has(state.selectedModelOptionRevisionRef)
        ? state.selectedModelOptionRevisionRef
        : persistedOption !== undefined && availableOptions.has(persistedOption)
          ? persistedOption
          : options.chatCatalog !== null && availableOptions.has(options.chatCatalog.defaultModelOptionRevisionRef)
            ? options.chatCatalog.defaultModelOptionRevisionRef
            : null
    const selectedOption = options.chatCatalog?.options.find(
      (option) => option.modelOptionRevisionRef === selectedModelOptionRevisionRef,
    )
    const persistedEffort = snapshot.model_history.at(-1)?.effort
    const selectedEffort = selectedOption === undefined || selectedOption.supportedEfforts.length === 0
      ? null
      : selectionSessionId === sessionId &&
        state.selectedEffort !== null &&
        selectedOption.supportedEfforts.includes(state.selectedEffort)
        ? state.selectedEffort
        : persistedEffort !== undefined && selectedOption.supportedEfforts.includes(persistedEffort)
          ? persistedEffort
          : selectedOption.supportedEfforts.includes("medium")
            ? "medium"
            : selectedOption.supportedEfforts[0] ?? null
    selectionSessionId = sessionId
    projectionStore.hydrate(snapshot)
    if (projectionStore.getSnapshot().repair.required) {
      projectionStore.dispatch({ type: "connection", connection: { kind: "reconnecting" } })
      publish({
        ...state,
        phase: "loading",
        sessionId,
        selectedModelOptionRevisionRef,
        selectedEffort,
        projection: projectionStore.getSnapshot(),
        failure: describeSessionFailure({
          stableCode: "SNAPSHOT_REQUIRED",
          action: "refetch_snapshot",
          retryClass: "after_user_action",
        }),
      })
      return false
    }
    publish({
      ...state,
      phase: "ready",
      sessionId,
      failure: null,
      selectedModelOptionRevisionRef,
      selectedEffort,
      projection: projectionStore.getSnapshot(),
    })
    let nextStream: EventStreamHandle | null = null
    const isCurrentStream = (): boolean =>
      currentGeneration === generation && (nextStream === null ? stream === null : stream === nextStream)
    nextStream = options.client.openEvents({
      sessionId,
      watermark: snapshot.snapshot_watermark,
      onEvent(event: SessionEvent) {
        if (!isCurrentStream()) return
        if (event.session_id !== sessionId) {
          failClosedForOwnerContract()
          return
        }
        if (event.kind === "session.updated") {
          if (!observeOwnerPolicy(sessionId, event.payload.session.session_id, event.payload.session.context_policy)) return
        }
        project({ type: "event", event })
        if (state.projection.repair.required) void repairFromSnapshot(currentGeneration)
      },
      onConnection(connection) {
        if (!isCurrentStream()) return
        project({ type: "connection", connection })
        if (connection.kind === "repair_required" || connection.kind === "auth_required") {
          void repairFromSnapshot(currentGeneration)
        } else if (connection.kind === "contract_incompatible") {
          fail(describeSessionFailure({
            stableCode: "CLIENT_CONTRACT_UPGRADE_REQUIRED",
            action: "upgrade_client",
            retryClass: "after_user_action",
          }))
        }
      },
    })
    stream = nextStream
    const attachedStream = nextStream
    void attachedStream.ready.then(() => {
      if (currentGeneration === generation && stream === attachedStream) {
        project({ type: "connection", connection: { kind: "live" } })
      }
    }).catch((error: unknown) => {
      if (currentGeneration === generation && stream === attachedStream) fail(failureFromError(error))
    })
    return true
  }

  const open = async (sessionId: string): Promise<void> => {
    const normalized = sessionId.trim()
    if (normalized.length === 0 || normalized.length > 128) {
      fail(describeSessionFailure({ stableCode: "REQUEST_INVALID", action: "developer_error", retryClass: "never" }))
      return
    }
    generation += 1
    const currentGeneration = generation
    stream?.close()
    stream = null
    projectionStore.reset()
    projectionStore.dispatch({
      type: "connection",
      connection: { kind: "connecting" },
    })
    publish({
      ...state,
      phase: "loading",
      sessionId: normalized,
      failure: null,
      projection: projectionStore.getSnapshot(),
    })
    try {
      const hydration = await options.client.hydrate(normalized)
      if (currentGeneration !== generation) return
      if (hydration.kind === "not_found") {
        publish({ ...state, phase: "not_found", failure: null })
        return
      }
      if (hydration.kind === "repair_required") {
        fail(describeSessionFailure({
          stableCode: "INTERNAL_UNAVAILABLE",
          action: "refetch_snapshot",
          retryClass: "after_user_action",
        }))
        return
      }
      if (hydration.kind === "contract_incompatible") {
        fail(describeSessionFailure({
          stableCode: "CLIENT_CONTRACT_UPGRADE_REQUIRED",
          action: "upgrade_client",
          retryClass: "after_user_action",
        }))
        return
      }
      attach(normalized, hydration.snapshot, currentGeneration)
    } catch (error) {
      if (currentGeneration === generation) fail(failureFromError(error))
    }
  }

  const refresh = async (sessionId: string, expectedGeneration: number): Promise<boolean> => {
    if (state.sessionId !== sessionId || generation !== expectedGeneration) return false
    const snapshot = await options.client.fetchSnapshot(sessionId)
    if (
      snapshot === null ||
      generation !== expectedGeneration ||
      state.sessionId !== sessionId
    ) return false
    return attach(sessionId, snapshot, expectedGeneration)
  }

  const reconcileReceipt = (
    response: SessionCommandResponse,
    command: CommandIdentity,
    operation: Parameters<SessionClient["getCommandReceipt"]>[1]["operation"],
  ): Promise<SessionCommandResponse> => reconcileCommandReceipt(
    options.client,
    response,
    command,
    operation,
  )

  const pendingFailure = (
    response: SessionCommandResponse,
    pendingCode: StableCode,
  ): ChatFailure | null => {
    const receipt = response.command_receipt
    if (receipt.status === "pending" || receipt.status === "outcome_unknown") {
      return describeSessionFailure({
        stableCode: pendingCode,
        action: receipt.payload.action,
        retryClass: receipt.payload.retry_class,
      })
    }
    return deniedFailure(response)
  }

  type ReceiptOperation = BrowserCommandOperation

  const rememberCommand = (
    operation: ReceiptOperation,
    targets: Readonly<Record<string, string>>,
    command: CommandIdentity,
    clientDraftRevision?: string,
    contextPolicy: SessionContextPolicy | null = null,
  ): void => {
    const record: SessionCommandRecoveryRecord = Object.freeze({
      schemaVersion: 1,
      operation,
      command,
      ...(targets.session_id === undefined ? {} : { sessionId: targets.session_id }),
      ...(clientDraftRevision === undefined ? {} : { clientDraftRevision }),
      createdAt: Date.now(),
    })
    contextCoordinator.remember(record, contextPolicy)
  }

  const forgetCommand = (commandId: string): void => {
    contextCoordinator.forget(commandId)
  }

  const sendCommand = async (
    operation: ReceiptOperation,
    targets: Readonly<Record<string, string>>,
    effect: Readonly<Record<string, unknown>>,
    pendingCode: StableCode,
    sender: (command: CommandIdentity) => Promise<SessionCommandResponse>,
    clientDraftRevision?: string,
    contextPolicy: SessionContextPolicy | null = state.projection.session?.contextPolicy ?? null,
  ): Promise<SessionCommandResponse | null> => {
    const commandGeneration = generation
    const failIfCurrent = (failure: ChatFailure): void => {
      if (commandGeneration === generation) fail(failure)
    }
    if (contextCoordinator.getPendingCommand() !== null) {
      failIfCurrent(describeSessionFailure({
        stableCode: "RUN_OUTCOME_UNKNOWN",
        action: "reconcile_receipt",
        retryClass: "reconcile_receipt",
      }))
      return null
    }
    const command = await commandIdentity({ operation, targets, effect })
    if (commandGeneration !== generation) return null
    rememberCommand(operation, targets, command, clientDraftRevision, contextPolicy)
    let response: SessionCommandResponse
    try {
      response = await sender(command)
    } catch {
      // An ambiguous transport failure is reconciled with the same command identity. It is
      // never retried as a new mutation because the first effect may already be committed.
      try {
        response = await options.client.getCommandReceipt(command.command_id, {
          operation,
          idempotency_key: command.idempotency_key,
          digest_algorithm: command.digest_algorithm,
          request_digest: command.request_digest,
        })
      } catch {
        failIfCurrent(describeSessionFailure({
          stableCode: pendingCode,
          action: "reconcile_receipt",
          retryClass: "reconcile_receipt",
        }))
        return null
      }
    }
    let reconciled: SessionCommandResponse
    try {
      reconciled = await reconcileReceipt(response, command, operation)
    } catch {
      failIfCurrent(describeSessionFailure({
        stableCode: pendingCode,
        action: "reconcile_receipt",
        retryClass: "reconcile_receipt",
      }))
      return null
    }
    const failure = pendingFailure(reconciled, pendingCode)
    if (failure !== null) {
      if (reconciled.command_receipt.status === "denied") forgetCommand(command.command_id)
      failIfCurrent(failure)
      return null
    }
    forgetCommand(command.command_id)
    return reconciled
  }

  const resumePendingCommand = async (): Promise<boolean> => {
    const pending = contextCoordinator.getPendingCommand()
    if (pending === null) return false
    project({ type: "command", state: "pending" })
    let response: SessionCommandResponse
    try {
      response = await options.client.getCommandReceipt(pending.command.command_id, {
        operation: pending.operation,
        idempotency_key: pending.command.idempotency_key,
        digest_algorithm: pending.command.digest_algorithm,
        request_digest: pending.command.request_digest,
      })
      response = await reconcileReceipt(response, pending.command, pending.operation)
    } catch {
      fail(describeSessionFailure({
        stableCode: "RUN_OUTCOME_UNKNOWN",
        action: "reconcile_receipt",
        retryClass: "reconcile_receipt",
      }))
      return false
    }
    const failure = pendingFailure(response, "RUN_OUTCOME_UNKNOWN")
    if (failure !== null) {
      if (response.command_receipt.status === "denied") forgetCommand(pending.command.command_id)
      fail(failure)
      return false
    }
    if (response.command_receipt.status !== "accepted" && response.command_receipt.status !== "applied") {
      fail(describeSessionFailure({
        stableCode: "RUN_OUTCOME_UNKNOWN",
        action: "reconcile_receipt",
        retryClass: "reconcile_receipt",
      }))
      return false
    }
    forgetCommand(pending.command.command_id)
    const effect = response.command_receipt.payload
    const appliedDraftRevision = pending.operation === "submit_message"
      ? pending.clientDraftRevision ?? null
      : null
    if (effect.kind === "session-created") {
      await open(effect.payload.session_id)
      return state.phase === "ready" && state.sessionId === effect.payload.session_id
    }
    const sessionId = pending.sessionId ?? state.sessionId
    if (sessionId === null) {
      project({ type: "command", state: "idle" })
      return true
    }
    if (state.sessionId !== sessionId) {
      await open(sessionId)
      const ready = state.phase === "ready" && state.sessionId === sessionId
      if (ready) {
        projectionStore.dispatch({ type: "command", state: "idle" })
        publish({
          ...state,
          appliedDraft: appliedDraftRevision === null
            ? state.appliedDraft
            : { sessionId, revision: appliedDraftRevision },
          projection: projectionStore.getSnapshot(),
        })
      }
      return ready
    }
    return finishMutation(sessionId, generation, appliedDraftRevision)
  }

  const selectedExecutionInput = (): Readonly<{
    modelOptionRevisionRef: string
    effort?: string
  }> | null => {
    const modelOptionRevisionRef = state.selectedModelOptionRevisionRef
    if (modelOptionRevisionRef === null) {
      fail(describeSessionFailure({
        stableCode: "MODEL_OPTION_UNAVAILABLE",
        action: "choose_model",
        retryClass: "after_user_action",
      }))
      return null
    }
    return {
      modelOptionRevisionRef,
      ...(state.selectedEffort === null ? {} : { effort: state.selectedEffort }),
    }
  }

  const mutationAuthority = () => {
    const sessionId = state.sessionId
    const session = state.projection.session
    if (
      state.phase !== "ready" ||
      state.projection.repair.required ||
      sessionId === null ||
      session === null ||
      session.id !== sessionId
    ) return null
    return { sessionId, session }
  }

  const inputParts = (messageId: string): MessageInputPart[] | null => {
    const message = state.projection.messages.find((candidate) => candidate.id === messageId)
    if (message === undefined) return null
    const parts = message.parts.flatMap((part): MessageInputPart[] => part.kind === "text"
      ? [{ schema_version: 1, kind: "text", payload: { text: part.text } }]
      : [])
    return parts.length === 0 ? null : parts
  }

  const attachmentIntents = (messageId: string) => {
    const message = state.projection.messages.find((candidate) => candidate.id === messageId)
    return message?.attachments.map(({ assetRef, assetVersionRef, assetGrantRef }) => ({
      asset_ref: assetRef,
      asset_version_ref: assetVersionRef,
      asset_grant_ref: assetGrantRef,
    })) ?? []
  }

  const finishMutation = async (
    sessionId: string,
    expectedGeneration: number,
    appliedDraftRevision: string | null = null,
  ): Promise<boolean> => {
    try {
      if (await refresh(sessionId, expectedGeneration)) {
        projectionStore.dispatch({ type: "command", state: "idle" })
        publish({
          ...state,
          appliedDraft: appliedDraftRevision === null
            ? state.appliedDraft
            : { sessionId, revision: appliedDraftRevision },
          projection: projectionStore.getSnapshot(),
        })
        return true
      }
    } catch {
      // The effect is terminal in its owner, but the browser has not observed the fresh
      // authority snapshot. Keep the command non-idle so the UI cannot imply convergence.
    }
    if (generation === expectedGeneration && state.sessionId === sessionId) {
      fail(describeSessionFailure({
        stableCode: "SNAPSHOT_REQUIRED",
        action: "refetch_snapshot",
        retryClass: "after_user_action",
      }))
    }
    return false
  }

  const create = async (contextPolicy: SessionContextPolicy): Promise<string | null> => {
    const projectRef = options.defaultProjectRef
    if (projectRef === null) {
      fail(describeSessionFailure({ stableCode: "SESSION_SCOPE_MISMATCH", action: "stop", retryClass: "never" }))
      return null
    }
    const createGeneration = generation
    const effect = { project_ref: projectRef, context_policy: contextPolicy }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand(
        "create_session",
        {},
        effect,
        "INTERNAL_UNAVAILABLE",
        (command) => options.client.createSession({ command, ...effect }),
        undefined,
        contextPolicy,
      )
      if (response === null) return null
      if (generation !== createGeneration) return null
      const receipt = response.command_receipt
      if (
        (receipt.status !== "accepted" && receipt.status !== "applied") ||
        receipt.payload.kind !== "session-created" ||
        receipt.payload.payload.context_policy !== contextPolicy
      ) {
        failClosedForOwnerContract()
        return null
      }
      const sessionId = receipt.payload.payload.session_id
      if (!observeOwnerPolicy(sessionId, sessionId, receipt.payload.payload.context_policy)) return null
      await open(sessionId)
      // The applied owner receipt makes this URL authoritative even when first hydration is
      // unavailable or needs repair. Only a policy/identity mismatch clears the Session ID.
      return state.sessionId === sessionId ? sessionId : null
    } catch (error) {
      fail(failureFromError(error))
      return null
    }
  }

  const submit = async (
    content: string,
    attachments: readonly AttachmentIntent[] = [],
    clientDraftRevision?: string,
  ): Promise<boolean> => {
    const authority = mutationAuthority()
    if (authority === null) return false
    const { session, sessionId } = authority
    const branchId = state.projection.activeBranchId
    const text = content.trim()
    if (
      branchId === null ||
      (text.length === 0 && attachments.length === 0) ||
      attachments.length > 64
    ) return false
    if (state.projection.activeRunId !== null) {
      fail(describeSessionFailure({
        stableCode: "ACTIVE_RUN_EXISTS",
        action: "wait_or_cancel",
        retryClass: "after_user_action",
      }))
      return false
    }
    const commandGeneration = generation
    const execution = selectedExecutionInput()
    if (execution === null) return false
    const effect = {
      expected_session_version: session.version,
      branch_id: branchId,
      parent_message_id: session.activeLeafMessageId ?? null,
      trusted_locale: options.trustedLocale,
      parts: text.length === 0
        ? []
        : [{ schema_version: 1 as const, kind: "text" as const, payload: { text } }],
      attachment_refs: attachments.map(({ asset_ref, asset_version_ref, asset_grant_ref }) => ({
        asset_ref,
        asset_version_ref,
        asset_grant_ref,
      })),
      model_option_revision_ref: execution.modelOptionRevisionRef,
      ...(execution.effort === undefined ? {} : { effort: execution.effort }),
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("submit_message", { session_id: sessionId }, effect, "LAUNCH_OUTCOME_UNKNOWN", (command) =>
        options.client.submitMessage(sessionId, { command, ...effect }), clientDraftRevision)
      return response === null
        ? false
        : await finishMutation(sessionId, commandGeneration, clientDraftRevision ?? null)
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const editMessage = async (messageId: string, content: string): Promise<boolean> => {
    const authority = mutationAuthority()
    if (authority === null) return false
    const { session, sessionId } = authority
    const source = state.projection.messages.find((message) => message.id === messageId)
    const branch = state.projection.branches.find((candidate) => candidate.id === source?.branchId)
    const text = content.trim()
    if (
      source?.role !== "user" || branch === undefined || text.length === 0 || state.projection.activeRunId !== null
    ) return false
    const execution = selectedExecutionInput()
    if (execution === null) return false
    const commandGeneration = generation
    const effect = {
      expected_session_version: session.version,
      expected_branch_version: branch.version,
      source_branch_id: source.branchId,
      source_message_id: source.id,
      parent_message_id: source.parentMessageId ?? null,
      trusted_locale: options.trustedLocale,
      replacement_parts: [{ schema_version: 1 as const, kind: "text" as const, payload: { text } }],
      replacement_attachment_refs: attachmentIntents(source.id),
      model_option_revision_ref: execution.modelOptionRevisionRef,
      ...(execution.effort === undefined ? {} : { effort: execution.effort }),
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("edit_message", { session_id: sessionId, message_id: source.id }, effect, "LAUNCH_OUTCOME_UNKNOWN", (command) =>
        options.client.editMessage(sessionId, source.id, { command, ...effect }))
      return response === null ? false : await finishMutation(sessionId, commandGeneration)
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const regenerateMessage = async (messageId: string): Promise<boolean> => {
    const authority = mutationAuthority()
    if (authority === null) return false
    const { session, sessionId } = authority
    const source = state.projection.messages.find((message) => message.id === messageId)
    const trigger = state.projection.messages.find((message) => message.id === source?.triggerMessageId)
    const branch = state.projection.branches.find((candidate) => candidate.id === source?.branchId)
    const parts = trigger === undefined ? null : inputParts(trigger.id)
    if (
      source?.role !== "assistant" || trigger?.role !== "user" || branch === undefined ||
      parts === null || state.projection.activeRunId !== null
    ) return false
    const execution = selectedExecutionInput()
    if (execution === null) return false
    const commandGeneration = generation
    const effect = {
      expected_session_version: session.version,
      expected_branch_version: branch.version,
      source_branch_id: source.branchId,
      source_assistant_message_id: source.id,
      trigger_message_id: trigger.id,
      parent_message_id: trigger.parentMessageId ?? null,
      trusted_locale: options.trustedLocale,
      input_parts: parts,
      attachment_refs: attachmentIntents(trigger.id),
      model_option_revision_ref: execution.modelOptionRevisionRef,
      ...(execution.effort === undefined ? {} : { effort: execution.effort }),
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("regenerate_message", { session_id: sessionId, message_id: source.id }, effect, "LAUNCH_OUTCOME_UNKNOWN", (command) =>
        options.client.regenerateMessage(sessionId, source.id, { command, ...effect }))
      return response === null ? false : await finishMutation(sessionId, commandGeneration)
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const branchMutation = async (
    branchId: string,
    operation: "fork_branch" | "activate_branch",
  ): Promise<boolean> => {
    const authority = mutationAuthority()
    if (authority === null) return false
    const { session, sessionId } = authority
    const branch = state.projection.branches.find((candidate) => candidate.id === branchId)
    if (branch === undefined || state.projection.activeRunId !== null) return false
    const commandGeneration = generation
    const effect = {
      expected_session_version: session.version,
      expected_branch_version: branch.version,
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand(operation, { session_id: sessionId, branch_id: branchId }, effect, "INTERNAL_UNAVAILABLE", (command) =>
        operation === "fork_branch"
          ? options.client.forkBranch(sessionId, branchId, { command, ...effect })
          : options.client.activateBranch(sessionId, branchId, { command, ...effect }))
      return response === null ? false : await finishMutation(sessionId, commandGeneration)
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const cancel = async (): Promise<void> => {
    const authority = mutationAuthority()
    if (authority === null) return
    const { sessionId } = authority
    const runId = state.projection.activeRunId
    if (runId === null) return
    const version = state.projection.activeRunProjectionVersion
    if (version === null) {
      fail(describeSessionFailure({
        stableCode: "RUN_OUTCOME_UNKNOWN",
        action: "refetch_snapshot",
        retryClass: "after_user_action",
      }))
      return
    }
    const effect = { expected_run_projection_version: version, reason_code: "user_requested" }
    const commandGeneration = generation
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("cancel_run", { session_id: sessionId, run_id: runId }, effect, "RUN_CANCELLATION_PENDING", (command) =>
        options.client.cancelRun(sessionId, runId, { command, ...effect }))
      if (response !== null) await finishMutation(sessionId, commandGeneration)
    } catch (error) {
      fail(failureFromError(error))
    }
  }

  const decideAction: ChatController["decideAction"] = async ({ runId, part, decision }) => {
    const authority = mutationAuthority()
    if (authority === null) return
    const { session, sessionId } = authority
    const runVersion = state.projection.activeRunId === runId
      ? state.projection.activeRunProjectionVersion
      : null
    if (
      runVersion === null ||
      part.status !== "pending" || !part.allowedActions.includes(decision.kind) ||
      part.deadline !== undefined && Date.parse(part.deadline) <= Date.now()
    ) {
      fail(describeSessionFailure({ stableCode: "ACTION_NOT_ALLOWED", action: "refetch_snapshot", retryClass: "after_user_action" }))
      return
    }
    const effect = {
      expected_session_version: session.version,
      expected_run_projection_version: runVersion,
      owner_kind: part.kind,
      owner_ref: part.ownerRef,
      decision_group_ref: part.decisionGroupRef,
      expected_owner_version: part.expectedVersion,
      decision,
    }
    const commandGeneration = generation
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("decide_action", { session_id: sessionId, run_id: runId }, effect, "ACTION_DECISION_PENDING", (command) =>
        options.client.decideAction(sessionId, runId, { command, ...effect }))
      if (response !== null) await finishMutation(sessionId, commandGeneration)
    } catch (error) {
      fail(failureFromError(error))
    }
  }

  const decidePlan: ChatController["decidePlan"] = async ({ runId, part, decision }) => {
    const authority = mutationAuthority()
    if (authority === null) return
    const { session, sessionId } = authority
    const runVersion = state.projection.activeRunId === runId
      ? state.projection.activeRunProjectionVersion
      : null
    if (
      runVersion === null ||
      part.status !== "pending" || !part.allowedActions.includes(decision.kind) ||
      part.deadline !== undefined && Date.parse(part.deadline) <= Date.now()
    ) {
      fail(describeSessionFailure({ stableCode: "PLAN_NOT_FOUND", action: "refetch_snapshot", retryClass: "after_user_action" }))
      return
    }
    const effect = {
      expected_session_version: session.version,
      expected_run_projection_version: runVersion,
      plan_proposal_ref: part.planProposalRef,
      expected_plan_version: part.planVersion,
      decision,
    }
    const commandGeneration = generation
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("decide_plan", { session_id: sessionId, run_id: runId }, effect, "PLAN_DECISION_PENDING", (command) =>
        options.client.decidePlan(sessionId, runId, { command, ...effect }))
      if (response !== null) await finishMutation(sessionId, commandGeneration)
    } catch (error) {
      fail(failureFromError(error))
    }
  }

  return Object.freeze({
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    create,
    open,
    submit,
    editMessage,
    regenerateMessage,
    forkBranch: (branchId) => branchMutation(branchId, "fork_branch"),
    activateBranch: (branchId) => branchMutation(branchId, "activate_branch"),
    cancel,
    recover() {
      if (repairTask?.generation === generation) return repairTask.task
      if (state.failure?.action === "reconcile_receipt") return resumePendingCommand()
      if (
        state.failure === null ||
        !["refetch_snapshot", "refresh_grant", "retry_same_cursor", "poll_or_stream"].includes(state.failure.action)
      ) return Promise.resolve(false)
      return repairFromSnapshot(generation)
    },
    resumePendingCommand,
    selectModelOption(modelOptionRevisionRef) {
      const selectable = options.chatCatalog?.options.some(
        (option) => option.modelOptionRevisionRef === modelOptionRevisionRef && option.availability === "available",
      ) === true
      if (!selectable) {
        fail(describeSessionFailure({ stableCode: "MODEL_OPTION_UNAVAILABLE", action: "choose_model", retryClass: "after_user_action" }))
        return
      }
      selectionSessionId = state.sessionId
      const selected = options.chatCatalog?.options.find(
        (option) => option.modelOptionRevisionRef === modelOptionRevisionRef,
      )
      const selectedEffort = selected === undefined || selected.supportedEfforts.length === 0
        ? null
        : state.selectedEffort !== null && selected.supportedEfforts.includes(state.selectedEffort)
          ? state.selectedEffort
          : selected.supportedEfforts.includes("medium")
            ? "medium"
            : selected.supportedEfforts[0] ?? null
      publish({ ...state, selectedModelOptionRevisionRef: modelOptionRevisionRef, selectedEffort, failure: null })
    },
    selectEffort(effort) {
      const selected = options.chatCatalog?.options.find(
        (option) => option.modelOptionRevisionRef === state.selectedModelOptionRevisionRef,
      )
      if (effort !== null && selected?.supportedEfforts.includes(effort) !== true) {
        fail(describeSessionFailure({ stableCode: "REQUEST_INVALID", action: "choose_model", retryClass: "after_user_action" }))
        return
      }
      selectionSessionId = state.sessionId
      publish({ ...state, selectedEffort: effort, failure: null })
    },
    decideAction,
    decidePlan,
    close() {
      generation += 1
      repairTask = null
      stream?.close()
      stream = null
      project({ type: "connection", connection: { kind: "closed" } })
    },
  })
}
