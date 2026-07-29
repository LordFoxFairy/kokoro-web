import {
  SessionClientError,
  type EventStreamHandle,
  type SessionClient,
} from "@kokoro/session-client"
import type {
  CommandIdentity,
  ErrorDetail,
  SessionCommandResponse,
  SessionEvent,
  SessionSnapshot,
} from "@kokoro/session-client/contracts"
import {
  createChatProjection,
  reduceChatProjection,
  type ChatProjection,
} from "@kokoro/chat-surface"

type StableCode = ErrorDetail["code"]
type StableAction = ErrorDetail["action"]
type RetryClass = ErrorDetail["retry_class"]

export type ReferenceChatFailure = Readonly<{
  code: StableCode
  action: StableAction
  retryClass: RetryClass
  message: string
}>

export type ReferenceChatState = Readonly<{
  phase: "idle" | "loading" | "ready" | "not_found"
  sessionId: string | null
  snapshot: SessionSnapshot | null
  projection: ChatProjection
  failure: ReferenceChatFailure | null
  hitlDecisionSupported: false
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

export function describeSessionFailure(input: FailureLike): ReferenceChatFailure {
  const code = asStableCode(input.stableCode)
  return {
    code,
    action: asStableAction(input.action),
    retryClass: asRetryClass(input.retryClass),
    message: FAILURE_COPY[code] ?? "The session request could not be completed.",
  }
}

function failureFromError(error: unknown): ReferenceChatFailure {
  return error instanceof SessionClientError
    ? describeSessionFailure(error)
    : describeSessionFailure({})
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Command payload contains a non-finite number")
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.entries(value as Readonly<Record<string, unknown>>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`
  }
  throw new Error("Command payload cannot be canonically serialized")
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function commandIdentity(effect: unknown): Promise<CommandIdentity> {
  const commandId = globalThis.crypto.randomUUID()
  return {
    command_id: commandId,
    idempotency_key: `web:${commandId}`,
    digest_algorithm: "SHA256_CANONICAL_JSON_V1",
    request_digest: await sha256(canonicalJson(effect)),
  }
}

function deniedFailure(response: SessionCommandResponse): ReferenceChatFailure | null {
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

export type ReferenceChatController = Readonly<{
  getSnapshot(): ReferenceChatState
  subscribe(listener: () => void): () => void
  open(sessionId: string): Promise<void>
  submit(content: string): Promise<void>
  cancel(): Promise<void>
  close(): void
}>

export function createReferenceChatController(options: {
  readonly client: SessionClient
  readonly trustedLocale: string
}): ReferenceChatController {
  let state: ReferenceChatState = {
    phase: "idle",
    sessionId: null,
    snapshot: null,
    projection: createChatProjection(),
    failure: null,
    hitlDecisionSupported: false,
  }
  let stream: EventStreamHandle | null = null
  let generation = 0
  const runProjectionVersions = new Map<string, number>()
  const listeners = new Set<() => void>()

  const publish = (next: ReferenceChatState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const project = (action: Parameters<typeof reduceChatProjection>[1]): void => {
    publish({ ...state, projection: reduceChatProjection(state.projection, action) })
  }
  const fail = (failure: ReferenceChatFailure): void => {
    publish({ ...state, failure })
    project({
      type: "command",
      state: failure.action === "reconcile_receipt" ? "conflict" : "failed",
      detail: failure.code,
    })
  }

  const attach = (sessionId: string, snapshot: SessionSnapshot, currentGeneration: number): void => {
    runProjectionVersions.clear()
    for (const run of snapshot.runs) runProjectionVersions.set(run.run_id, run.projection_version)
    publish({
      ...state,
      phase: "ready",
      sessionId,
      snapshot,
      failure: null,
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
      },
      onConnection(connection) {
        if (currentGeneration !== generation) return
        project({ type: "connection", connection })
        if (connection.kind === "contract_incompatible") {
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

  const refresh = async (): Promise<void> => {
    const sessionId = state.sessionId
    if (sessionId === null) return
    const snapshot = await options.client.fetchSnapshot(sessionId)
    if (snapshot !== null) attach(sessionId, snapshot, generation)
  }

  const submit = async (content: string): Promise<void> => {
    const snapshot = state.snapshot
    const sessionId = state.sessionId
    const text = content.trim()
    if (snapshot === null || sessionId === null || text.length === 0) return
    const model = snapshot.model_history.at(-1)
    if (model === undefined) {
      fail(describeSessionFailure({
        stableCode: "MODEL_OPTION_UNAVAILABLE",
        action: "choose_model",
        retryClass: "after_user_action",
      }))
      return
    }
    const effect = {
      expected_session_version: snapshot.session.version,
      branch_id: snapshot.session.active_branch_id,
      parent_message_id: snapshot.session.active_leaf_message_id ?? null,
      trusted_locale: options.trustedLocale,
      parts: [{ schema_version: 1 as const, kind: "text" as const, payload: { text } }],
      attachment_refs: [],
      model_option_revision_ref: model.model_option_revision_ref,
    }
    project({ type: "command", state: "pending" })
    try {
      const response = await options.client.submitMessage(sessionId, {
        command: await commandIdentity(effect),
        ...effect,
      })
      const failure = deniedFailure(response)
      if (failure !== null) {
        fail(failure)
        return
      }
      project({ type: "command", state: "idle" })
      await refresh()
    } catch (error) {
      fail(failureFromError(error))
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
      const response = await options.client.cancelRun(sessionId, runId, {
        command: await commandIdentity(effect),
        ...effect,
      })
      const failure = deniedFailure(response)
      if (failure !== null) {
        fail(failure)
        return
      }
      project({ type: "command", state: "idle" })
      await refresh()
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
    open,
    submit,
    cancel,
    close() {
      generation += 1
      stream?.close()
      stream = null
      project({ type: "connection", connection: { kind: "closed" } })
    },
  })
}
