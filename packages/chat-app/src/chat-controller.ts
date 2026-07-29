import {
  SessionClientError,
  type EventStreamHandle,
  type SessionClient,
} from "@kokoro/session-client"
import type {
  ActionDecision,
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
  createChatProjection,
  reduceChatProjection,
  type ChatPart,
  type ChatProjection,
} from "@kokoro/chat-surface"

import {
  createCommandIdentity,
  reconcileCommandReceipt,
} from "./command"
import type {
  SessionCommandRecoveryRecord,
  SessionCommandRecoveryStore,
} from "./command-recovery"

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
  snapshot: SessionSnapshot | null
  projection: ChatProjection
  failure: ChatFailure | null
  chatCatalog: ModelOptionCatalog | null
  selectedModelOptionRevisionRef: string | null
  selectedEffort: string | null
  hitlDecisionSupported: true
}>

type FailureLike = Readonly<{
  stableCode?: string
  action?: string
  retryClass?: string
}>

const FAILURE_COPY: Partial<Record<StableCode, string>> = {
  SESSION_SCOPE_MISMATCH: "This session is not available in the current product context.",
  SESSION_ACCESS_GRANT_REQUIRED: "Your session access needs to be refreshed.",
  SESSION_ACCESS_GRANT_EXPIRED: "Your session access expired. Sign in again to continue.",
  SESSION_ACCESS_GRANT_REVOKED: "Your session access was revoked.",
  MODEL_OPTION_UNAVAILABLE: "No published model option is available for this session.",
  ADMISSION_DENIED: "This run was not admitted.",
  ADMISSION_OUTCOME_UNKNOWN: "Run admission is still being reconciled.",
  RUN_OUTCOME_UNKNOWN: "The run outcome is still being reconciled.",
  INTERNAL_UNAVAILABLE: "Chat is temporarily unavailable.",
}

const VALID_CODES = new Set<StableCode>([
  "REQUEST_INVALID", "PAYLOAD_TOO_LARGE", "METHOD_NOT_ALLOWED", "UNSUPPORTED_MEDIA_TYPE",
  "BFF_WORKLOAD_REQUIRED", "BFF_WORKLOAD_REVOKED", "SESSION_ACCESS_GRANT_REQUIRED",
  "SESSION_ACCESS_GRANT_EXPIRED", "SESSION_ACCESS_GRANT_REVOKED", "SESSION_SCOPE_MISMATCH",
  "SESSION_NOT_FOUND", "SESSION_VERSION_CONFLICT", "IDEMPOTENCY_CONFLICT", "ACTIVE_RUN_EXISTS",
  "CAPABILITY_SNAPSHOT_LOCKED", "MODEL_OPTION_UNAVAILABLE", "ATTACHMENT_NOT_READY",
  "ATTACHMENT_REVOKED", "ADMISSION_DENIED", "ADMISSION_OUTCOME_UNKNOWN", "LAUNCH_OUTCOME_UNKNOWN",
  "RUN_CANCELLATION_PENDING", "RUN_OUTCOME_UNKNOWN", "CURSOR_INVALID", "CURSOR_CONFLICT",
  "ACTION_NOT_FOUND", "ACTION_VERSION_CONFLICT", "ACTION_EXPIRED", "ACTION_NOT_ALLOWED",
  "ACTION_DECISION_PENDING", "PLAN_NOT_FOUND", "PLAN_VERSION_CONFLICT", "PLAN_EXPIRED",
  "PLAN_DECISION_PENDING",
  "CURSOR_AHEAD", "SNAPSHOT_REQUIRED", "CURSOR_SCOPE_MISMATCH", "STREAM_EPOCH_MISMATCH",
  "CLIENT_CONTRACT_UPGRADE_REQUIRED", "PART_SCHEMA_UNSUPPORTED", "INTERNAL_UNAVAILABLE",
])
const VALID_ACTIONS = new Set<StableAction>([
  "retry_same_cursor", "refresh_grant", "reauthenticate", "refetch_snapshot", "upgrade_client",
  "stop", "developer_error", "wait_or_cancel", "fork_new_session", "choose_model",
  "wait_prerequisite", "remove_attachment", "show_reason", "reconcile_receipt", "poll_or_stream",
  "render_unsupported",
])
const VALID_RETRY_CLASSES = new Set<RetryClass>([
  "never", "immediate", "after_delay", "after_user_action", "reconcile_receipt",
])

function asStableCode(value: string | undefined): StableCode {
  return value !== undefined && VALID_CODES.has(value as StableCode)
    ? value as StableCode
    : "INTERNAL_UNAVAILABLE"
}

function asStableAction(value: string | undefined): StableAction {
  return value !== undefined && VALID_ACTIONS.has(value as StableAction)
    ? value as StableAction
    : "stop"
}

function asRetryClass(value: string | undefined): RetryClass {
  return value !== undefined && VALID_RETRY_CLASSES.has(value as RetryClass)
    ? value as RetryClass
    : "never"
}

export function describeSessionFailure(input: FailureLike): ChatFailure {
  const code = asStableCode(input.stableCode)
  return {
    code,
    action: asStableAction(input.action),
    retryClass: asRetryClass(input.retryClass),
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
    case "repair_required":
      return describeSessionFailure({
        stableCode: "INTERNAL_UNAVAILABLE",
        action: "refetch_snapshot",
        retryClass: "immediate",
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
  create(): Promise<string | null>
  open(sessionId: string): Promise<void>
  submit(content: string): Promise<boolean>
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
  let state: ChatState = {
    phase: "idle",
    sessionId: null,
    snapshot: null,
    projection: createChatProjection(),
    failure: null,
    chatCatalog: options.chatCatalog,
    selectedModelOptionRevisionRef: null,
    selectedEffort: null,
    hitlDecisionSupported: true,
  }
  let stream: EventStreamHandle | null = null
  let repairTask: Promise<boolean> | null = null
  let pendingCommand = options.commandRecoveryStore?.load() ?? null
  let generation = 0
  const runProjectionVersions = new Map<string, number>()
  const listeners = new Set<() => void>()

  const publish = (next: ChatState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const project = (action: Parameters<typeof reduceChatProjection>[1]): void => {
    publish({ ...state, projection: reduceChatProjection(state.projection, action) })
  }
  const fail = (failure: ChatFailure): void => {
    publish({ ...state, failure })
    project({
      type: "command",
      state: failure.action === "reconcile_receipt" ? "conflict" : "failed",
      detail: failure.code,
    })
  }

  const repairFromSnapshot = (expectedGeneration: number): Promise<boolean> => {
    if (repairTask !== null) return repairTask
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
          publish({ ...state, phase: "not_found", snapshot: null, failure: null })
          return false
        }
        attach(sessionId, snapshot, expectedGeneration)
        return true
      } catch (error) {
        if (expectedGeneration === generation) fail(failureFromError(error))
        return false
      }
    })()
    repairTask = task
    void task.finally(() => {
      if (repairTask === task) repairTask = null
    })
    return task
  }

  const attach = (sessionId: string, snapshot: SessionSnapshot, currentGeneration: number): void => {
    runProjectionVersions.clear()
    for (const run of snapshot.runs) runProjectionVersions.set(run.run_id, run.projection_version)
    const availableOptions = new Set(
      options.chatCatalog?.options
        .filter(({ availability }) => availability === "available")
        .map(({ modelOptionRevisionRef }) => modelOptionRevisionRef) ?? [],
    )
    const persistedOption = snapshot.model_history.at(-1)?.model_option_revision_ref
    const selectedModelOptionRevisionRef =
      state.selectedModelOptionRevisionRef !== null && availableOptions.has(state.selectedModelOptionRevisionRef)
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
      : state.selectedEffort !== null && selectedOption.supportedEfforts.includes(state.selectedEffort)
        ? state.selectedEffort
        : persistedEffort !== undefined && selectedOption.supportedEfforts.includes(persistedEffort)
          ? persistedEffort
          : selectedOption.supportedEfforts.includes("medium")
            ? "medium"
            : selectedOption.supportedEfforts[0] ?? null
    publish({
      ...state,
      phase: "ready",
      sessionId,
      snapshot,
      failure: null,
      selectedModelOptionRevisionRef,
      selectedEffort,
      projection: reduceChatProjection(state.projection, { type: "snapshot", snapshot }),
    })
    stream?.close()
    stream = options.client.openEvents({
      sessionId,
      watermark: snapshot.snapshot_watermark,
      onEvent(event: SessionEvent) {
        if (currentGeneration !== generation) return
        if (event.kind === "run.view.updated") {
          runProjectionVersions.set(event.payload.run.run_id, event.payload.run.projection_version)
        }
        project({ type: "event", event })
        if (state.projection.repair.required) void repairFromSnapshot(currentGeneration)
      },
      onConnection(connection) {
        if (currentGeneration !== generation) return
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
    void stream.ready.then(() => {
      if (currentGeneration === generation) project({ type: "connection", connection: { kind: "live" } })
    }).catch((error: unknown) => {
      if (currentGeneration === generation) fail(failureFromError(error))
    })
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
    publish({
      ...state,
      phase: "loading",
      sessionId: normalized,
      snapshot: null,
      failure: null,
      projection: reduceChatProjection(createChatProjection(), {
        type: "connection",
        connection: { kind: "connecting" },
      }),
    })
    try {
      const hydration = await options.client.hydrate(normalized)
      if (currentGeneration !== generation) return
      if (hydration.kind === "not_found") {
        publish({ ...state, phase: "not_found", failure: null })
        return
      }
      if (hydration.kind !== "ready") {
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

  const refresh = async (): Promise<boolean> => {
    const sessionId = state.sessionId
    if (sessionId === null) return false
    const snapshot = await options.client.fetchSnapshot(sessionId)
    if (snapshot === null) return false
    attach(sessionId, snapshot, generation)
    return true
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
  ): void => {
    const record: SessionCommandRecoveryRecord = Object.freeze({
      schemaVersion: 1,
      operation,
      command,
      ...(targets.session_id === undefined ? {} : { sessionId: targets.session_id }),
      createdAt: Date.now(),
    })
    pendingCommand = record
    options.commandRecoveryStore?.save(record)
  }

  const forgetCommand = (commandId: string): void => {
    if (pendingCommand?.command.command_id === commandId) pendingCommand = null
    options.commandRecoveryStore?.clear(commandId)
  }

  const sendCommand = async (
    operation: ReceiptOperation,
    targets: Readonly<Record<string, string>>,
    effect: Readonly<Record<string, unknown>>,
    pendingCode: StableCode,
    sender: (command: CommandIdentity) => Promise<SessionCommandResponse>,
  ): Promise<SessionCommandResponse | null> => {
    if (pendingCommand !== null) {
      fail(describeSessionFailure({
        stableCode: "RUN_OUTCOME_UNKNOWN",
        action: "reconcile_receipt",
        retryClass: "reconcile_receipt",
      }))
      return null
    }
    const command = await commandIdentity({ operation, targets, effect })
    rememberCommand(operation, targets, command)
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
        fail(describeSessionFailure({
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
      fail(describeSessionFailure({
        stableCode: pendingCode,
        action: "reconcile_receipt",
        retryClass: "reconcile_receipt",
      }))
      return null
    }
    const failure = pendingFailure(reconciled, pendingCode)
    if (failure !== null) {
      if (reconciled.command_receipt.status === "denied") forgetCommand(command.command_id)
      fail(failure)
      return null
    }
    forgetCommand(command.command_id)
    return reconciled
  }

  const resumePendingCommand = async (): Promise<boolean> => {
    const pending = pendingCommand
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
      return state.phase === "ready" && state.sessionId === sessionId
    }
    return finishMutation()
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

  const inputParts = (messageId: string): MessageInputPart[] | null => {
    const message = state.snapshot?.messages.find((candidate) => candidate.message_id === messageId)
    if (message === undefined) return null
    const parts = message.parts.flatMap((part): MessageInputPart[] => part.kind === "text"
      ? [{ schema_version: 1, kind: "text", payload: { text: part.payload.spans.map(({ text }) => text).join("") } }]
      : [])
    return parts.length === 0 ? null : parts
  }

  const attachmentIntents = (messageId: string) => {
    const message = state.snapshot?.messages.find((candidate) => candidate.message_id === messageId)
    return message?.attachments.map(({ asset_ref, asset_version_ref, asset_grant_ref }) => ({
      asset_ref,
      asset_version_ref,
      asset_grant_ref,
    })) ?? []
  }

  const finishMutation = async (): Promise<boolean> => {
    try {
      if (await refresh()) {
        project({ type: "command", state: "idle" })
        return true
      }
    } catch {
      // The effect is terminal in its owner, but the browser has not observed the fresh
      // authority snapshot. Keep the command non-idle so the UI cannot imply convergence.
    }
    fail(describeSessionFailure({
      stableCode: "SNAPSHOT_REQUIRED",
      action: "refetch_snapshot",
      retryClass: "immediate",
    }))
    return false
  }

  const create = async (): Promise<string | null> => {
    const projectRef = options.defaultProjectRef
    if (projectRef === null) {
      fail(describeSessionFailure({ stableCode: "SESSION_SCOPE_MISMATCH", action: "stop", retryClass: "never" }))
      return null
    }
    const effect = { project_ref: projectRef }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("create_session", {}, effect, "INTERNAL_UNAVAILABLE", (command) =>
        options.client.createSession({ command, ...effect }))
      if (response === null) return null
      const receipt = response.command_receipt
      if (
        (receipt.status !== "accepted" && receipt.status !== "applied") ||
        receipt.payload.kind !== "session-created"
      ) {
        fail(describeSessionFailure({ stableCode: "INTERNAL_UNAVAILABLE", action: "reconcile_receipt", retryClass: "reconcile_receipt" }))
        return null
      }
      const sessionId = receipt.payload.payload.session_id
      await open(sessionId)
      return state.phase === "ready" && state.sessionId === sessionId ? sessionId : null
    } catch (error) {
      fail(failureFromError(error))
      return null
    }
  }

  const submit = async (content: string): Promise<boolean> => {
    const snapshot = state.snapshot
    const sessionId = state.sessionId
    const text = content.trim()
    if (snapshot === null || sessionId === null || text.length === 0) return false
    const execution = selectedExecutionInput()
    if (execution === null) return false
    const effect = {
      expected_session_version: snapshot.session.version,
      branch_id: snapshot.session.active_branch_id,
      parent_message_id: snapshot.session.active_leaf_message_id ?? null,
      trusted_locale: options.trustedLocale,
      parts: [{ schema_version: 1 as const, kind: "text" as const, payload: { text } }],
      attachment_refs: [],
      model_option_revision_ref: execution.modelOptionRevisionRef,
      ...(execution.effort === undefined ? {} : { effort: execution.effort }),
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("submit_message", { session_id: sessionId }, effect, "LAUNCH_OUTCOME_UNKNOWN", (command) =>
        options.client.submitMessage(sessionId, { command, ...effect }))
      return response === null ? false : await finishMutation()
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const editMessage = async (messageId: string, content: string): Promise<boolean> => {
    const snapshot = state.snapshot
    const sessionId = state.sessionId
    const source = snapshot?.messages.find((message) => message.message_id === messageId)
    const branch = snapshot?.branches.find((candidate) => candidate.branch_id === source?.branch_id)
    const text = content.trim()
    const execution = selectedExecutionInput()
    if (
      snapshot === null || sessionId === null || source?.role !== "user" || branch === undefined ||
      text.length === 0 || execution === null || state.projection.activeRunId !== null
    ) return false
    const effect = {
      expected_session_version: snapshot.session.version,
      expected_branch_version: branch.version,
      source_branch_id: source.branch_id,
      source_message_id: source.message_id,
      parent_message_id: source.parent_message_id ?? null,
      trusted_locale: options.trustedLocale,
      replacement_parts: [{ schema_version: 1 as const, kind: "text" as const, payload: { text } }],
      replacement_attachment_refs: attachmentIntents(source.message_id),
      model_option_revision_ref: execution.modelOptionRevisionRef,
      ...(execution.effort === undefined ? {} : { effort: execution.effort }),
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("edit_message", { session_id: sessionId, message_id: source.message_id }, effect, "LAUNCH_OUTCOME_UNKNOWN", (command) =>
        options.client.editMessage(sessionId, source.message_id, { command, ...effect }))
      return response === null ? false : await finishMutation()
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const regenerateMessage = async (messageId: string): Promise<boolean> => {
    const snapshot = state.snapshot
    const sessionId = state.sessionId
    const source = snapshot?.messages.find((message) => message.message_id === messageId)
    const trigger = snapshot?.messages.find((message) => message.message_id === source?.trigger_message_id)
    const branch = snapshot?.branches.find((candidate) => candidate.branch_id === source?.branch_id)
    const parts = trigger === undefined ? null : inputParts(trigger.message_id)
    const execution = selectedExecutionInput()
    if (
      snapshot === null || sessionId === null || source?.role !== "assistant" || trigger?.role !== "user" ||
      branch === undefined || parts === null || execution === null || state.projection.activeRunId !== null
    ) return false
    const effect = {
      expected_session_version: snapshot.session.version,
      expected_branch_version: branch.version,
      source_branch_id: source.branch_id,
      source_assistant_message_id: source.message_id,
      trigger_message_id: trigger.message_id,
      parent_message_id: trigger.parent_message_id ?? null,
      trusted_locale: options.trustedLocale,
      input_parts: parts,
      attachment_refs: attachmentIntents(trigger.message_id),
      model_option_revision_ref: execution.modelOptionRevisionRef,
      ...(execution.effort === undefined ? {} : { effort: execution.effort }),
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("regenerate_message", { session_id: sessionId, message_id: source.message_id }, effect, "LAUNCH_OUTCOME_UNKNOWN", (command) =>
        options.client.regenerateMessage(sessionId, source.message_id, { command, ...effect }))
      return response === null ? false : await finishMutation()
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const branchMutation = async (
    branchId: string,
    operation: "fork_branch" | "activate_branch",
  ): Promise<boolean> => {
    const snapshot = state.snapshot
    const sessionId = state.sessionId
    const branch = snapshot?.branches.find((candidate) => candidate.branch_id === branchId)
    if (snapshot === null || sessionId === null || branch === undefined || state.projection.activeRunId !== null) return false
    const effect = {
      expected_session_version: snapshot.session.version,
      expected_branch_version: branch.version,
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand(operation, { session_id: sessionId, branch_id: branchId }, effect, "INTERNAL_UNAVAILABLE", (command) =>
        operation === "fork_branch"
          ? options.client.forkBranch(sessionId, branchId, { command, ...effect })
          : options.client.activateBranch(sessionId, branchId, { command, ...effect }))
      return response === null ? false : await finishMutation()
    } catch (error) {
      fail(failureFromError(error))
      return false
    }
  }

  const cancel = async (): Promise<void> => {
    const sessionId = state.sessionId
    const runId = state.projection.activeRunId
    if (sessionId === null || runId === null) return
    const version = runProjectionVersions.get(runId)
    if (version === undefined) {
      fail(describeSessionFailure({
        stableCode: "RUN_OUTCOME_UNKNOWN",
        action: "refetch_snapshot",
        retryClass: "immediate",
      }))
      return
    }
    const effect = { expected_run_projection_version: version, reason_code: "user_requested" }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("cancel_run", { session_id: sessionId, run_id: runId }, effect, "RUN_CANCELLATION_PENDING", (command) =>
        options.client.cancelRun(sessionId, runId, { command, ...effect }))
      if (response !== null) await finishMutation()
    } catch (error) {
      fail(failureFromError(error))
    }
  }

  const decideAction: ChatController["decideAction"] = async ({ runId, part, decision }) => {
    const snapshot = state.snapshot
    const sessionId = state.sessionId
    const runVersion = runProjectionVersions.get(runId)
    if (
      snapshot === null || sessionId === null || runVersion === undefined ||
      part.status !== "pending" || !part.allowedActions.includes(decision.kind) ||
      part.deadline !== undefined && Date.parse(part.deadline) <= Date.now()
    ) {
      fail(describeSessionFailure({ stableCode: "ACTION_NOT_ALLOWED", action: "refetch_snapshot", retryClass: "after_user_action" }))
      return
    }
    const effect = {
      expected_session_version: snapshot.session.version,
      expected_run_projection_version: runVersion,
      owner_kind: part.kind,
      owner_ref: part.ownerRef,
      decision_group_ref: part.decisionGroupRef,
      expected_owner_version: part.expectedVersion,
      decision,
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("decide_action", { session_id: sessionId, run_id: runId }, effect, "ACTION_DECISION_PENDING", (command) =>
        options.client.decideAction(sessionId, runId, { command, ...effect }))
      if (response !== null) await finishMutation()
    } catch (error) {
      fail(failureFromError(error))
    }
  }

  const decidePlan: ChatController["decidePlan"] = async ({ runId, part, decision }) => {
    const snapshot = state.snapshot
    const sessionId = state.sessionId
    const runVersion = runProjectionVersions.get(runId)
    if (
      snapshot === null || sessionId === null || runVersion === undefined ||
      part.status !== "pending" || !part.allowedActions.includes(decision.kind) ||
      part.deadline !== undefined && Date.parse(part.deadline) <= Date.now()
    ) {
      fail(describeSessionFailure({ stableCode: "PLAN_NOT_FOUND", action: "refetch_snapshot", retryClass: "after_user_action" }))
      return
    }
    const effect = {
      expected_session_version: snapshot.session.version,
      expected_run_projection_version: runVersion,
      plan_proposal_ref: part.planProposalRef,
      expected_plan_version: part.planVersion,
      decision,
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await sendCommand("decide_plan", { session_id: sessionId, run_id: runId }, effect, "PLAN_DECISION_PENDING", (command) =>
        options.client.decidePlan(sessionId, runId, { command, ...effect }))
      if (response !== null) await finishMutation()
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
