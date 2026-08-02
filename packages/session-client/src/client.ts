import { ZodError, type ZodType } from "zod";

import {
  LAST_EVENT_ID_HEADER,
  errorEnvelopeSchema,
  SESSION_HTTP_ENDPOINTS,
  type ActionDecisionRequest,
  type BranchCommandRequest,
  type CancellationRequest,
  type CommandReceiptLookupQuery,
  type CreateFolderRequest,
  type CreateSessionRequest,
  type EditMessageRequest,
  type ErrorEnvelope,
  type FolderDeleteRequest,
  type FolderList,
  type FolderListQuery,
  type ListSessionsQuery,
  type PreferenceRequest,
  type PlanDecisionRequest,
  type RegenerateMessageRequest,
  type SessionCommandResponse,
  type SessionLifecycleCommandRequest,
  type SessionList,
  type SessionSnapshot,
  type SubmitMessageRequest,
  type UpdateFolderRequest,
  type UpdateSessionRequest,
} from "./contracts.js";
import {
  AGUI_CURSOR_PROFILE_REVISION,
  AGUI_PRESENTATION_PROFILE_REVISION,
  SESSION_AGUI_CONTRACT_REVISION,
  AguiPresentationProtocolError,
  createAguiPresentationDecoder,
  type AguiGrantBinding,
  type AguiPresentationSnapshotAuthority,
} from "./agui-presentation-state-machine.internal.js";
import type {
  AguiPresentationHydration,
  OpenAguiPresentationInput,
} from "./agui-presentation.js";
import type { CursorRecovery } from "./cursor-policy.js";

export type SessionRequest = {
  readonly method: (typeof SESSION_HTTP_ENDPOINTS)[keyof typeof SESSION_HTTP_ENDPOINTS]["method"];
  readonly path: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
};

export type SessionResponse = {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
};

export type SessionStreamResponse = {
  readonly status: number;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | null;
};

/** The app owns only a contract-relative BFF transport, never a Session URL, Site, or credential. */
export type SessionTransport = {
  readonly request: (request: SessionRequest) => Promise<SessionResponse>;
  readonly stream: (request: SessionRequest) => Promise<SessionStreamResponse>;
};

export type SessionClientErrorKind =
  | "auth_required"
  | "command_conflict"
  | "contract_incompatible"
  | "http"
  | "network"
  | "protocol"
  | "repair_required";

export class SessionClientError extends Error {
  readonly status?: number;
  readonly recovery?: CursorRecovery;
  readonly stableCode?: ErrorEnvelope["error"]["code"];
  readonly action?: ErrorEnvelope["error"]["action"];
  readonly retryClass?: ErrorEnvelope["error"]["retry_class"];
  readonly correlationId?: string;

  constructor(
    readonly kind: SessionClientErrorKind,
    message: string,
    options: {
      readonly status?: number;
      readonly recovery?: CursorRecovery;
      readonly problem?: ErrorEnvelope;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "SessionClientError";
    if (options.status !== undefined) this.status = options.status;
    if (options.recovery !== undefined) this.recovery = options.recovery;
    if (options.problem !== undefined) {
      this.stableCode = options.problem.error.code;
      this.action = options.problem.error.action;
      this.retryClass = options.problem.error.retry_class;
      this.correlationId = options.problem.correlation_id;
    }
  }
}

export type SessionHydration =
  | ({ readonly kind: "ready" } & AguiPresentationHydration)
  | { readonly kind: "not_found" }
  | { readonly kind: "contract_incompatible"; readonly snapshot: SessionSnapshot; readonly reason: string };

export type SessionConnectionState =
  | { readonly kind: "connecting" | "live" | "reconnecting" | "closed" }
  | { readonly kind: "auth_required" }
  | { readonly kind: "draining"; readonly retryAfterMs?: number }
  | { readonly kind: "repair_required"; readonly recovery: CursorRecovery }
  | { readonly kind: "contract_incompatible"; readonly reason: string };

export type EventStreamHandle = {
  readonly ready: Promise<void>;
  readonly close: () => void;
};

export type SnapshotRequestOptions = Readonly<{
  readonly signal?: AbortSignal;
}>;

export type SessionClient = {
  readonly fetchSnapshot: (sessionId: string, options?: SnapshotRequestOptions) => Promise<SessionSnapshot | null>;
  readonly hydrate: (sessionId: string, options?: SnapshotRequestOptions) => Promise<SessionHydration>;
  readonly listSessions: (query: ListSessionsQuery) => Promise<SessionList>;
  readonly createSession: (body: CreateSessionRequest) => Promise<SessionCommandResponse>;
  readonly submitMessage: (sessionId: string, body: SubmitMessageRequest) => Promise<SessionCommandResponse>;
  readonly editMessage: (sessionId: string, messageId: string, body: EditMessageRequest) => Promise<SessionCommandResponse>;
  readonly regenerateMessage: (sessionId: string, messageId: string, body: RegenerateMessageRequest) => Promise<SessionCommandResponse>;
  readonly forkBranch: (sessionId: string, branchId: string, body: BranchCommandRequest) => Promise<SessionCommandResponse>;
  readonly activateBranch: (sessionId: string, branchId: string, body: BranchCommandRequest) => Promise<SessionCommandResponse>;
  readonly cancelRun: (sessionId: string, runId: string, body: CancellationRequest) => Promise<SessionCommandResponse>;
  readonly decideAction: (sessionId: string, runId: string, body: ActionDecisionRequest) => Promise<SessionCommandResponse>;
  readonly decidePlan: (sessionId: string, runId: string, body: PlanDecisionRequest) => Promise<SessionCommandResponse>;
  readonly getCommandReceipt: (commandId: string, query: CommandReceiptLookupQuery) => Promise<SessionCommandResponse>;
  readonly updateSession: (sessionId: string, body: UpdateSessionRequest) => Promise<SessionCommandResponse>;
  readonly archiveSession: (sessionId: string, body: SessionLifecycleCommandRequest) => Promise<SessionCommandResponse>;
  readonly restoreSession: (sessionId: string, body: SessionLifecycleCommandRequest) => Promise<SessionCommandResponse>;
  readonly trashSession: (sessionId: string, body: SessionLifecycleCommandRequest) => Promise<SessionCommandResponse>;
  readonly putPreference: (sessionId: string, body: PreferenceRequest) => Promise<SessionCommandResponse>;
  readonly listFolders: (query: FolderListQuery) => Promise<FolderList>;
  readonly createFolder: (body: CreateFolderRequest) => Promise<SessionCommandResponse>;
  readonly updateFolder: (folderId: string, body: UpdateFolderRequest) => Promise<SessionCommandResponse>;
  readonly deleteFolder: (folderId: string, body: FolderDeleteRequest) => Promise<SessionCommandResponse>;
  readonly openPresentation: (input: OpenAguiPresentationInput) => EventStreamHandle;
};

type SseFrame = Readonly<{ id: string | null; event: string | null; data: string | null }>;
type SessionOperationId = keyof typeof SESSION_HTTP_ENDPOINTS;
const AGUI_REHYDRATION_CODES = new Set([
  "agui_cursor_gap",
  "agui_draining_cursor_conflict",
  "agui_stream_identity_duplicate",
  "agui_stream_scope_conflict",
]);

export const SESSION_CLIENT_OPERATION_SURFACE = {
  createSession: "createSession",
  listSessions: "listSessions",
  snapshot: "fetchSnapshot",
  stream: "openPresentation",
  submitMessage: "submitMessage",
  editMessage: "editMessage",
  regenerateMessage: "regenerateMessage",
  forkBranch: "forkBranch",
  activateBranch: "activateBranch",
  cancelRun: "cancelRun",
  decideAction: "decideAction",
  decidePlan: "decidePlan",
  getCommandReceipt: "getCommandReceipt",
  updateSession: "updateSession",
  archiveSession: "archiveSession",
  restoreSession: "restoreSession",
  trashSession: "trashSession",
  putPreference: "putPreference",
  listFolders: "listFolders",
  createFolder: "createFolder",
  updateFolder: "updateFolder",
  deleteFolder: "deleteFolder",
} as const satisfies Readonly<Record<SessionOperationId, keyof SessionClient>>;
type SchemaOutput<Schema> = Schema extends ZodType<infer Output> ? Output : never;
type OperationResponse<Operation extends SessionOperationId> = SchemaOutput<
  NonNullable<(typeof SESSION_HTTP_ENDPOINTS)[Operation]["responseSchema"]>
>;

function parseContract<T>(raw: unknown, schema: ZodType<T>): T {
  try {
    return schema.parse(raw);
  } catch (error) {
    throw new SessionClientError("contract_incompatible", "Session payload rejected by Root contract", {
      cause: error instanceof ZodError ? error : undefined,
    });
  }
}

function parseGenerated(raw: unknown, schema: ZodType): unknown {
  try {
    return schema.parse(raw) as unknown;
  } catch (error) {
    throw new SessionClientError("contract_incompatible", "Session payload rejected by Root contract", {
      cause: error instanceof ZodError ? error : undefined,
    });
  }
}

function parseProblem(body: unknown): ErrorEnvelope | undefined {
  const parsed = errorEnvelopeSchema.safeParse(body);
  return parsed.success ? parsed.data : undefined;
}

function responseError(
  method: string,
  path: string,
  response: SessionResponse | SessionStreamResponse,
): SessionClientError {
  const problem = "body" in response ? parseProblem(response.body) : undefined;
  const message = problem?.error.message ?? `${method} ${path} failed with status ${response.status}`;
  const common = { status: response.status, problem };
  if (problem === undefined) return new SessionClientError("http", message, common);
  const { action, code } = problem.error;
  if (
    action === "refresh_grant" || action === "reauthenticate" ||
    code === "SESSION_ACCESS_GRANT_REQUIRED" || code === "SESSION_ACCESS_GRANT_EXPIRED" ||
    code === "SESSION_ACCESS_GRANT_REVOKED"
  ) {
    return new SessionClientError("auth_required", message, common);
  }
  if (action === "reconcile_receipt" || code === "IDEMPOTENCY_CONFLICT") {
    return new SessionClientError("command_conflict", message, common);
  }
  if (action === "upgrade_client" || action === "developer_error" || code === "CLIENT_CONTRACT_UPGRADE_REQUIRED") {
    return new SessionClientError("contract_incompatible", message, common);
  }
  if (
    action === "refetch_snapshot" || action === "retry_same_cursor" ||
    code === "CURSOR_INVALID" || code === "CURSOR_CONFLICT" || code === "CURSOR_AHEAD" ||
    code === "CURSOR_SCOPE_MISMATCH" || code === "STREAM_EPOCH_MISMATCH" || code === "SNAPSHOT_REQUIRED"
  ) {
    return new SessionClientError("repair_required", message, {
      ...common,
      recovery: action === "refetch_snapshot"
        ? { kind: "rehydrate", reason: "cursor_expired" }
        : { kind: "repair_required", reason: "cursor_conflict" },
    });
  }
  return new SessionClientError("http", message, common);
}

function queryString(value: Readonly<Record<string, unknown>>): string {
  const query = new URLSearchParams();
  for (const key of Object.keys(value).sort()) {
    const field = value[key];
    if (field !== undefined) query.set(key, String(field));
  }
  return query.toString();
}

function withQuery(path: string, query: Readonly<Record<string, unknown>>): string {
  const serialized = queryString(query);
  return serialized.length === 0 ? path : `${path}?${serialized}`;
}

function operationRequest(
  operationId: SessionOperationId,
  input: Readonly<{
    pathParameters?: unknown;
    query?: unknown;
    body?: unknown;
    signal?: AbortSignal;
  }> = {},
): SessionRequest {
  const endpoint = SESSION_HTTP_ENDPOINTS[operationId];
  let path: string = endpoint.path;
  if (endpoint.pathSchema === null) {
    if (input.pathParameters !== undefined) {
      throw new SessionClientError("protocol", `${operationId} does not accept path parameters`);
    }
  } else {
    const parameters = parseGenerated(input.pathParameters, endpoint.pathSchema);
    if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
      throw new SessionClientError("protocol", `${operationId} path parameters are invalid`);
    }
    for (const [name, rawValue] of Object.entries(parameters)) {
      if (typeof rawValue !== "string") {
        throw new SessionClientError("protocol", `${operationId} path parameter is invalid`);
      }
      path = path.replace(`{${name}}`, encodeURIComponent(rawValue));
    }
    if (path.includes("{") || path.includes("}")) {
      throw new SessionClientError("protocol", `${operationId} path is incomplete`);
    }
  }
  if (endpoint.querySchema === null) {
    if (input.query !== undefined) {
      throw new SessionClientError("protocol", `${operationId} does not accept query parameters`);
    }
  } else {
    const query = parseGenerated(input.query ?? {}, endpoint.querySchema);
    if (typeof query !== "object" || query === null || Array.isArray(query)) {
      throw new SessionClientError("protocol", `${operationId} query is invalid`);
    }
    path = withQuery(path, query as Readonly<Record<string, unknown>>);
  }
  let body: unknown;
  if (endpoint.requestSchema === null) {
    if (input.body !== undefined) {
      throw new SessionClientError("protocol", `${operationId} does not accept a body`);
    }
  } else {
    body = parseGenerated(input.body, endpoint.requestSchema);
  }
  return Object.freeze({
    method: endpoint.method,
    path,
    ...(body === undefined ? {} : {
      headers: { "content-type": "application/json" },
      body,
    }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
}

function createSseParser(
  onFrame: (frame: SseFrame) => void,
  maximumBufferedBytes: number,
  maximumFrameBytes: number,
) {
  let line = "";
  let frameLines: string[] = [];
  let pendingCr = false;
  const encoder = new TextEncoder();

  const emit = (frame: string): void => {
    if (encoder.encode(frame).byteLength > maximumFrameBytes) {
      throw new SessionClientError("protocol", "SSE frame exceeds the bounded contract limit");
    }
    let id: string | null = null;
    let event: string | null = null;
    const data: string[] = [];
    for (const frameLine of frame.split("\n")) {
      if (frameLine.startsWith(":")) continue;
      const separator = frameLine.indexOf(":");
      const field = separator < 0 ? frameLine : frameLine.slice(0, separator);
      const raw = separator < 0 ? "" : frameLine.slice(separator + 1);
      const value = raw.startsWith(" ") ? raw.slice(1) : raw;
      if (field === "id" && id === null) id = value;
      else if (field === "event" && event === null) event = value;
      else if (field === "data") data.push(value);
      else if (field.length > 0) throw new SessionClientError("protocol", "SSE field is unsupported");
    }
    if (id !== null || event !== null || data.length > 0) {
      onFrame({ id, event, data: data.length === 0 ? null : data.join("\n") });
    }
  };

  const endLine = (): void => {
    if (line.length > 0) {
      frameLines.push(line);
      line = "";
      return;
    }
    if (frameLines.length > 0) emit(frameLines.join("\n"));
    frameLines = [];
  };

  const bufferedBytes = (): number => encoder.encode([
    ...frameLines,
    line + (pendingCr ? "\r" : ""),
  ].join("\n")).byteLength;

  const consume = (chunk: string): void => {
    for (const character of chunk) {
      if (pendingCr) {
        pendingCr = false;
        endLine();
        if (character === "\n") continue;
      }
      if (character === "\r") pendingCr = true;
      else if (character === "\n") endLine();
      else line += character;
    }
  };

  return Object.freeze({
    push(chunk: string) {
      consume(chunk);
      if (bufferedBytes() > maximumBufferedBytes) {
        throw new SessionClientError("protocol", "SSE buffer exceeds the bounded contract limit");
      }
    },
    finish() {
      if (pendingCr) {
        pendingCr = false;
        endLine();
      }
      if (line.length !== 0 || frameLines.length !== 0) {
        throw new SessionClientError("protocol", "SSE stream ended with an incomplete frame");
      }
    },
  });
}

async function decodeProblemStream(
  response: SessionStreamResponse,
  maximumBytes = 131_072,
): Promise<ErrorEnvelope> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (response.body === null || contentType !== "application/problem+json") {
    throw new SessionClientError("protocol", "Session stream error did not return a problem envelope", {
      status: response.status,
    });
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximumBytes) {
        throw new SessionClientError("protocol", "Session stream problem exceeds the bounded limit", {
          status: response.status,
        });
      }
      chunks.push(result.value);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(merged));
    } catch (error) {
      throw new SessionClientError("protocol", "Session stream problem is not valid UTF-8 JSON", {
        status: response.status,
        cause: error,
      });
    }
    return parseContract(raw, errorEnvelopeSchema);
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    throw error;
  }
}

export function createSessionClient(options: {
  readonly transport: SessionTransport;
  readonly reconnectDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
  readonly random?: () => number;
  readonly maximumSseBufferBytes?: number;
  readonly maximumSseFrameBytes?: number;
}): SessionClient {
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
  const random = options.random ?? Math.random;
  const maximumSseBufferBytes = options.maximumSseBufferBytes ?? 1_048_576;
  const maximumSseFrameBytes = options.maximumSseFrameBytes ?? 524_288;

  const executeOperation = async <Operation extends SessionOperationId>(
    operationId: Operation,
    operationInput: Parameters<typeof operationRequest>[1] = {},
  ): Promise<OperationResponse<Operation>> => {
    const input = operationRequest(operationId, operationInput);
    const endpoint = SESSION_HTTP_ENDPOINTS[operationId];
    let response: SessionResponse;
    try {
      response = await options.transport.request(input);
    } catch (error) {
      throw new SessionClientError("network", `${input.method} ${input.path} failed`, { cause: error });
    }
    if (response.status !== endpoint.status) {
      throw responseError(input.method, input.path, response);
    }
    if (endpoint.responseSchema === null) {
      throw new SessionClientError("protocol", `${operationId} has no JSON response schema`);
    }
    return parseGenerated(response.body, endpoint.responseSchema) as OperationResponse<Operation>;
  };

  const fetchSnapshot = async (
    sessionId: string,
    requestOptions: SnapshotRequestOptions = {},
  ): Promise<SessionSnapshot | null> => {
    const endpoint = SESSION_HTTP_ENDPOINTS.snapshot;
    const input = operationRequest("snapshot", {
      pathParameters: { session_id: sessionId },
      ...(endpoint.querySchema === null ? {} : { query: {} }),
      ...(requestOptions.signal === undefined ? {} : { signal: requestOptions.signal }),
    });
    let response: SessionResponse;
    try {
      response = await options.transport.request(input);
    } catch (error) {
      throw new SessionClientError("network", `${input.method} ${input.path} failed`, { cause: error });
    }
    if (response.status === 404) return null;
    if (response.status !== endpoint.status) {
      throw responseError(input.method, input.path, response);
    }
    if (endpoint.responseSchema === null) throw new SessionClientError("protocol", "Snapshot schema missing");
    const snapshot = parseContract(response.body, endpoint.responseSchema);
    if (snapshot.session.session_id !== sessionId) {
      throw new SessionClientError("contract_incompatible", "Snapshot Session identity mismatch");
    }
    return snapshot;
  };

  return Object.freeze({
    fetchSnapshot,
    async hydrate(sessionId, requestOptions = {}) {
      const snapshot = await fetchSnapshot(sessionId, requestOptions);
      if (snapshot === null) return { kind: "not_found" };
      const grant: AguiGrantBinding = Object.freeze({
        sessionId,
        sessionContractRevision: SESSION_AGUI_CONTRACT_REVISION,
        presentationProfileRevision: AGUI_PRESENTATION_PROFILE_REVISION,
        cursorProfileRevision: AGUI_CURSOR_PROFILE_REVISION,
      });
      try {
        const authorityDecoder = createAguiPresentationDecoder({
          grant,
          snapshotAuthority: snapshot.presentation_authority,
        });
        const snapshotAuthority: AguiPresentationSnapshotAuthority = authorityDecoder.getSnapshotAuthority();
        return { kind: "ready", snapshot, grant, snapshotAuthority };
      } catch (error) {
        if (error instanceof AguiPresentationProtocolError) {
          return { kind: "contract_incompatible", snapshot, reason: error.code };
        }
        throw error;
      }
    },
    listSessions(query) {
      return executeOperation("listSessions", { query });
    },
    createSession: (body) => executeOperation("createSession", { body }),
    submitMessage: (sessionId, body) => executeOperation("submitMessage", {
      pathParameters: { session_id: sessionId }, body,
    }),
    editMessage: (sessionId, messageId, body) => executeOperation("editMessage", {
      pathParameters: { session_id: sessionId, message_id: messageId }, body,
    }),
    regenerateMessage: (sessionId, messageId, body) => executeOperation("regenerateMessage", {
      pathParameters: { session_id: sessionId, message_id: messageId }, body,
    }),
    forkBranch: (sessionId, branchId, body) => executeOperation("forkBranch", {
      pathParameters: { session_id: sessionId, branch_id: branchId }, body,
    }),
    activateBranch: (sessionId, branchId, body) => executeOperation("activateBranch", {
      pathParameters: { session_id: sessionId, branch_id: branchId }, body,
    }),
    cancelRun: (sessionId, runId, body) => executeOperation("cancelRun", {
      pathParameters: { session_id: sessionId, run_id: runId }, body,
    }),
    decideAction: (sessionId, runId, body) => executeOperation("decideAction", {
      pathParameters: { session_id: sessionId, run_id: runId }, body,
    }),
    decidePlan: (sessionId, runId, body) => executeOperation("decidePlan", {
      pathParameters: { session_id: sessionId, run_id: runId }, body,
    }),
    getCommandReceipt: (commandId, query) => executeOperation("getCommandReceipt", {
      pathParameters: { command_id: commandId }, query,
    }),
    updateSession: (sessionId, body) => executeOperation("updateSession", {
      pathParameters: { session_id: sessionId }, body,
    }),
    archiveSession: (sessionId, body) => executeOperation("archiveSession", {
      pathParameters: { session_id: sessionId }, body,
    }),
    restoreSession: (sessionId, body) => executeOperation("restoreSession", {
      pathParameters: { session_id: sessionId }, body,
    }),
    trashSession: (sessionId, body) => executeOperation("trashSession", {
      pathParameters: { session_id: sessionId }, body,
    }),
    putPreference: (sessionId, body) => executeOperation("putPreference", {
      pathParameters: { session_id: sessionId }, body,
    }),
    listFolders(query) {
      return executeOperation("listFolders", { query });
    },
    createFolder: (body) => executeOperation("createFolder", { body }),
    updateFolder: (folderId, body) => executeOperation("updateFolder", {
      pathParameters: { folder_id: folderId }, body,
    }),
    deleteFolder: (folderId, body) => executeOperation("deleteFolder", {
      pathParameters: { folder_id: folderId }, body,
    }),
    openPresentation(input) {
      const streamEndpoint = SESSION_HTTP_ENDPOINTS.stream;
      let closed = false;
      let controller: AbortController | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let reconnectAttempt = 0;
      let firstConnection = true;
      let resolveReady!: () => void;
      let rejectReady!: (error: unknown) => void;
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
      });

      const fail = (error: SessionClientError): void => {
        controller?.abort();
        if (firstConnection) rejectReady(error);
        if (error.kind === "auth_required") input.onConnection({ kind: "auth_required" });
        else if (error.kind === "contract_incompatible") {
          input.onConnection({ kind: "contract_incompatible", reason: error.message });
        } else {
          input.onConnection({
            kind: "repair_required",
            recovery: error.recovery ?? { kind: "repair_required", reason: "cursor_rejected" },
          });
        }
      };

      const retryAfterMs = (headers?: Headers): number | null => {
        const raw = headers?.get("retry-after");
        if (raw === null || raw === undefined) return null;
        const seconds = Number(raw);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, reconnectMaxDelayMs);
        const timestamp = Date.parse(raw);
        return Number.isFinite(timestamp)
          ? Math.min(Math.max(0, timestamp - Date.now()), reconnectMaxDelayMs)
          : null;
      };

      const scheduleReconnect = (headers?: Headers, requestedDelayMs?: number): void => {
        if (closed) return;
        input.onConnection({ kind: "reconnecting" });
        const cap = Math.min(reconnectMaxDelayMs, reconnectDelayMs * 2 ** Math.min(reconnectAttempt, 20));
        const delay = requestedDelayMs === undefined
          ? retryAfterMs(headers) ?? Math.floor(random() * (cap + 1))
          : Math.min(requestedDelayMs, reconnectMaxDelayMs);
        reconnectAttempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void connect();
        }, delay);
      };

      const connect = async (): Promise<void> => {
        if (closed) return;
        let resume: ReturnType<OpenAguiPresentationInput["resume"]>;
        let streamRequest: SessionRequest;
        try {
          resume = input.resume();
          if (
            resume.headers[LAST_EVENT_ID_HEADER] !== resume.queryCursor ||
            resume.cursorBinding.cursor !== resume.queryCursor ||
            resume.cursorBinding.sessionId !== input.sessionId
          ) {
            throw new SessionClientError("contract_incompatible", "AG-UI resume authority is internally inconsistent");
          }
          streamRequest = operationRequest("stream", {
            pathParameters: { session_id: input.sessionId },
            query: { after: resume.queryCursor },
          });
        } catch (error) {
          fail(new SessionClientError("contract_incompatible", "AG-UI resume authority is invalid", { cause: error }));
          return;
        }
        controller = new AbortController();
        input.onConnection({ kind: firstConnection ? "connecting" : "reconnecting" });
        let response: SessionStreamResponse;
        try {
          response = await options.transport.stream({
            method: streamEndpoint.method,
            path: streamRequest.path,
            headers: { accept: "text/event-stream", ...resume.headers },
            signal: controller.signal,
          });
        } catch {
          if (closed) return;
          // Attaching an SSE GET is effect-free. A transient network failure before the
          // first response is therefore as safe to resume as a later disconnect and must
          // not strand a freshly hydrated conversation in an offline terminal state.
          scheduleReconnect();
          return;
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (response.status !== streamEndpoint.status) {
          let problem: ErrorEnvelope;
          try {
            problem = await decodeProblemStream(response);
          } catch (error) {
            fail(error instanceof SessionClientError
              ? error
              : new SessionClientError("protocol", "Session stream problem decoding failed", { cause: error }));
            return;
          }
          const error = responseError(streamEndpoint.method, streamRequest.path, {
            status: response.status,
            headers: response.headers,
            body: problem,
          });
          if (
            problem.error.action === "retry_same_cursor" ||
            problem.error.retry_class === "after_delay"
          ) {
            scheduleReconnect(response.headers);
          } else {
            fail(error);
          }
          return;
        }
        if (response.body === null || contentType !== "text/event-stream") {
          fail(new SessionClientError("protocol", "Session stream success response is not event-stream", {
            status: response.status,
          }));
          return;
        }
        input.onConnection({ kind: "live" });
        if (firstConnection) {
          firstConnection = false;
          resolveReady();
        }

        let terminalError: SessionClientError | null = null;
        let draining = false;
        let drainingRetryAfterMs: number | undefined;
        const parser = createSseParser((frame) => {
          if (frame.data === null) {
            throw new SessionClientError("protocol", "AG-UI SSE frame is missing data");
          }
          try {
            const disposition = input.onFrame(Object.freeze({
              id: frame.id,
              event: frame.event,
              data: frame.data,
            }));
            if (disposition.kind === "draining") {
              draining = true;
              drainingRetryAfterMs = disposition.retryAfterMs;
              input.onConnection({
                kind: "draining",
                ...(disposition.retryAfterMs === undefined ? {} : { retryAfterMs: disposition.retryAfterMs }),
              });
              controller?.abort();
            } else if (disposition.kind === "durable") {
              reconnectAttempt = 0;
            }
          } catch (error) {
            if (error instanceof AguiPresentationProtocolError && AGUI_REHYDRATION_CODES.has(error.code)) {
              throw new SessionClientError("repair_required", "AG-UI presentation authority requires rehydration", {
                cause: error,
                recovery: { kind: "repair_required", reason: "cursor_conflict" },
              });
            }
            throw new SessionClientError("contract_incompatible", "AG-UI presentation frame rejected", { cause: error });
          }
        }, maximumSseBufferBytes, maximumSseFrameBytes);

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            parser.push(decoder.decode(result.value, { stream: true }));
            if (draining || closed) break;
          }
          const tail = decoder.decode();
          if (tail.length > 0) parser.push(tail);
          if (!draining) parser.finish();
        } catch (error) {
          terminalError = error instanceof SessionClientError
            ? error
            : new SessionClientError("protocol", "SSE stream failed", { cause: error });
        }
        if (closed) return;
        if (terminalError !== null) fail(terminalError);
        else scheduleReconnect(response.headers, drainingRetryAfterMs);
      };

      void connect();
      return Object.freeze({
        ready,
        close() {
          if (closed) return;
          closed = true;
          controller?.abort();
          if (retryTimer !== null) clearTimeout(retryTimer);
          input.onConnection({ kind: "closed" });
        },
      });
    },
  });
}
