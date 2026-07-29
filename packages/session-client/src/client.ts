import { ZodError, type ZodType } from "zod";

import {
  LAST_EVENT_ID_HEADER,
  activateBranchPath,
  branchCommandRequestSchema,
  cancellationPath,
  cancellationRequestSchema,
  commandReceiptLookupQuerySchema,
  commandReceiptPath,
  createFolderRequestSchema,
  createSessionRequestSchema,
  editMessagePath,
  editMessageRequestSchema,
  errorEnvelopeSchema,
  eventsPath,
  folderDeleteRequestSchema,
  folderListQuerySchema,
  folderListSchema,
  folderPath,
  foldersPath,
  forkBranchPath,
  listSessionsQuerySchema,
  preferencePath,
  preferenceRequestSchema,
  regenerateMessagePath,
  regenerateMessageRequestSchema,
  sessionCommandResponseSchema,
  sessionLifecycleCommandRequestSchema,
  sessionListSchema,
  sessionPath,
  sessionStreamFrameSchema,
  sessionsPath,
  snapshotPath,
  submitMessageRequestSchema,
  messagesPath,
  updateFolderRequestSchema,
  updateSessionRequestSchema,
  archiveSessionPath,
  restoreSessionPath,
  trashSessionPath,
  sessionSnapshotSchema,
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
  type RegenerateMessageRequest,
  type SessionCommandResponse,
  type SessionEvent,
  type SessionLifecycleCommandRequest,
  type SessionList,
  type SessionSnapshot,
  type StreamControlFrame,
  type SubmitMessageRequest,
  type UpdateFolderRequest,
  type UpdateSessionRequest,
} from "./contracts.js";
import {
  createCursorPolicy,
  type CursorPolicy,
  type CursorRecovery,
  type SessionCursor,
} from "./cursor-policy.js";

export type SessionRequest = {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  | { readonly kind: "ready"; readonly snapshot: SessionSnapshot; readonly cursor: SessionCursor }
  | { readonly kind: "not_found" }
  | {
      readonly kind: "repair_required" | "contract_incompatible";
      readonly snapshot: SessionSnapshot;
      readonly reason: string;
    };

export type SessionConnectionState =
  | { readonly kind: "connecting" | "live" | "reconnecting" | "closed" }
  | { readonly kind: "auth_required" }
  | { readonly kind: "draining"; readonly control: StreamControlFrame }
  | { readonly kind: "repair_required"; readonly recovery: CursorRecovery }
  | { readonly kind: "contract_incompatible"; readonly reason: string };

export type OpenEventsInput = {
  readonly sessionId: string;
  readonly cursor: SessionCursor | string;
  readonly onEvent: (event: SessionEvent, cursor: SessionCursor) => void;
  readonly onConnection: (state: SessionConnectionState) => void;
};

export type EventStreamHandle = {
  readonly ready: Promise<void>;
  readonly close: () => void;
};

export type SessionClient = {
  readonly fetchSnapshot: (sessionId: string) => Promise<SessionSnapshot | null>;
  readonly hydrate: (sessionId: string) => Promise<SessionHydration>;
  readonly listSessions: (query: ListSessionsQuery) => Promise<SessionList>;
  readonly createSession: (body: CreateSessionRequest) => Promise<SessionCommandResponse>;
  readonly submitMessage: (sessionId: string, body: SubmitMessageRequest) => Promise<SessionCommandResponse>;
  readonly editMessage: (sessionId: string, messageId: string, body: EditMessageRequest) => Promise<SessionCommandResponse>;
  readonly regenerateMessage: (sessionId: string, messageId: string, body: RegenerateMessageRequest) => Promise<SessionCommandResponse>;
  readonly forkBranch: (sessionId: string, branchId: string, body: BranchCommandRequest) => Promise<SessionCommandResponse>;
  readonly activateBranch: (sessionId: string, branchId: string, body: BranchCommandRequest) => Promise<SessionCommandResponse>;
  readonly cancelRun: (sessionId: string, runId: string, body: CancellationRequest) => Promise<SessionCommandResponse>;
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
  readonly openEvents: (input: OpenEventsInput) => EventStreamHandle;
};

type SseFrame = Readonly<{ id: string | null; event: string | null; data: string | null }>;

function routeSegment(value: string, label: string): string {
  if (value.trim().length === 0 || value.length > 128) {
    throw new SessionClientError("protocol", `${label} is invalid`);
  }
  return encodeURIComponent(value);
}

function parseContract<T>(raw: unknown, schema: ZodType<T>): T {
  try {
    return schema.parse(raw);
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
  cursorPolicy: CursorPolicy,
): SessionClientError {
  const problem = "body" in response ? parseProblem(response.body) : undefined;
  const message = problem?.error.message ?? `${method} ${path} failed with status ${response.status}`;
  const common = { status: response.status, problem };
  if (response.status === 401 || response.status === 403) {
    return new SessionClientError("auth_required", message, common);
  }
  if (response.status === 409 && problem?.error.action === "reconcile_receipt") {
    return new SessionClientError("command_conflict", message, common);
  }
  if (problem?.error.action === "upgrade_client") {
    return new SessionClientError("contract_incompatible", message, common);
  }
  if ([409, 410, 412, 422, 426].includes(response.status)) {
    return new SessionClientError("repair_required", message, {
      ...common,
      recovery: cursorPolicy.onRejected(response.status),
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

function createSseParser(
  onFrame: (frame: SseFrame) => void,
  maximumBufferedBytes: number,
  maximumFrameBytes: number,
) {
  let buffer = "";
  const encoder = new TextEncoder();

  const emit = (frame: string): void => {
    if (encoder.encode(frame).byteLength > maximumFrameBytes) {
      throw new SessionClientError("protocol", "SSE frame exceeds the bounded contract limit");
    }
    let id: string | null = null;
    let event: string | null = null;
    const data: string[] = [];
    for (const line of frame.split(/\r?\n/u)) {
      if (line.startsWith(":")) continue;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const raw = separator < 0 ? "" : line.slice(separator + 1);
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

  const drain = (final: boolean): void => {
    for (;;) {
      const lf = buffer.indexOf("\n\n");
      const crlf = buffer.indexOf("\r\n\r\n");
      const index = lf < 0 ? crlf : crlf < 0 ? lf : Math.min(lf, crlf);
      if (index < 0) break;
      const width = crlf >= 0 && crlf === index ? 4 : 2;
      emit(buffer.slice(0, index));
      buffer = buffer.slice(index + width);
    }
    if (final && buffer.length !== 0) {
      throw new SessionClientError("protocol", "SSE stream ended with an incomplete frame");
    }
  };

  return Object.freeze({
    push(chunk: string) {
      buffer += chunk;
      if (encoder.encode(buffer).byteLength > maximumBufferedBytes) {
        throw new SessionClientError("protocol", "SSE buffer exceeds the bounded contract limit");
      }
      drain(false);
    },
    finish() {
      drain(true);
    },
  });
}

export function createSessionClient(options: {
  readonly transport: SessionTransport;
  readonly cursorPolicy?: CursorPolicy;
  readonly reconnectDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
  readonly random?: () => number;
  readonly maximumSseBufferBytes?: number;
  readonly maximumSseFrameBytes?: number;
}): SessionClient {
  const cursorPolicy = options.cursorPolicy ?? createCursorPolicy();
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const reconnectMaxDelayMs = options.reconnectMaxDelayMs ?? 30_000;
  const random = options.random ?? Math.random;
  const maximumSseBufferBytes = options.maximumSseBufferBytes ?? 1_048_576;
  const maximumSseFrameBytes = options.maximumSseFrameBytes ?? 524_288;

  const request = async <T>(
    input: SessionRequest,
    expectedStatus: number,
    schema: ZodType<T>,
  ): Promise<T> => {
    let response: SessionResponse;
    try {
      response = await options.transport.request(input);
    } catch (error) {
      throw new SessionClientError("network", `${input.method} ${input.path} failed`, { cause: error });
    }
    if (response.status !== expectedStatus) {
      throw responseError(input.method, input.path, response, cursorPolicy);
    }
    return parseContract(response.body, schema);
  };

  const command = <T>(
    method: SessionRequest["method"],
    path: string,
    body: T,
    schema: ZodType<T>,
    status: number,
  ) => request({
    method,
    path,
    headers: { "content-type": "application/json" },
    body: parseContract(body, schema),
  }, status, sessionCommandResponseSchema);

  const fetchSnapshot = async (sessionId: string): Promise<SessionSnapshot | null> => {
    const encodedSessionId = routeSegment(sessionId, "sessionId");
    const path = snapshotPath(encodedSessionId);
    let response: SessionResponse;
    try {
      response = await options.transport.request({ method: "GET", path });
    } catch (error) {
      throw new SessionClientError("network", `GET ${path} failed`, { cause: error });
    }
    if (response.status === 404) return null;
    if (response.status !== 200) throw responseError("GET", path, response, cursorPolicy);
    const snapshot = parseContract(response.body, sessionSnapshotSchema);
    if (snapshot.session.session_id !== sessionId) {
      throw new SessionClientError("contract_incompatible", "Snapshot Session identity mismatch");
    }
    return snapshot;
  };

  return Object.freeze({
    fetchSnapshot,
    async hydrate(sessionId) {
      const snapshot = await fetchSnapshot(sessionId);
      if (snapshot === null) return { kind: "not_found" };
      const acceptance = cursorPolicy.accept(snapshot.snapshot_watermark.cursor);
      if (acceptance.kind !== "ready") return { ...acceptance, snapshot };
      return { kind: "ready", snapshot, cursor: acceptance.cursor };
    },
    listSessions(query) {
      const parsed = parseContract(query, listSessionsQuerySchema);
      return request({ method: "GET", path: withQuery(sessionsPath(), parsed) }, 200, sessionListSchema);
    },
    createSession: (body) => command("POST", sessionsPath(), body, createSessionRequestSchema, 201),
    submitMessage: (sessionId, body) => command(
      "POST", messagesPath(routeSegment(sessionId, "sessionId")), body, submitMessageRequestSchema, 202,
    ),
    editMessage: (sessionId, messageId, body) => command(
      "POST",
      editMessagePath(routeSegment(sessionId, "sessionId"), routeSegment(messageId, "messageId")),
      body,
      editMessageRequestSchema,
      202,
    ),
    regenerateMessage: (sessionId, messageId, body) => command(
      "POST",
      regenerateMessagePath(routeSegment(sessionId, "sessionId"), routeSegment(messageId, "messageId")),
      body,
      regenerateMessageRequestSchema,
      202,
    ),
    forkBranch: (sessionId, branchId, body) => command(
      "POST",
      forkBranchPath(routeSegment(sessionId, "sessionId"), routeSegment(branchId, "branchId")),
      body,
      branchCommandRequestSchema,
      202,
    ),
    activateBranch: (sessionId, branchId, body) => command(
      "POST",
      activateBranchPath(routeSegment(sessionId, "sessionId"), routeSegment(branchId, "branchId")),
      body,
      branchCommandRequestSchema,
      202,
    ),
    cancelRun: (sessionId, runId, body) => command(
      "POST",
      cancellationPath(routeSegment(sessionId, "sessionId"), routeSegment(runId, "runId")),
      body,
      cancellationRequestSchema,
      202,
    ),
    getCommandReceipt(commandId, query) {
      const parsed = parseContract(query, commandReceiptLookupQuerySchema);
      return request({
        method: "GET",
        path: withQuery(commandReceiptPath(routeSegment(commandId, "commandId")), parsed),
      }, 200, sessionCommandResponseSchema);
    },
    updateSession: (sessionId, body) => command(
      "PATCH", sessionPath(routeSegment(sessionId, "sessionId")), body, updateSessionRequestSchema, 202,
    ),
    archiveSession: (sessionId, body) => command(
      "POST", archiveSessionPath(routeSegment(sessionId, "sessionId")), body, sessionLifecycleCommandRequestSchema, 202,
    ),
    restoreSession: (sessionId, body) => command(
      "POST", restoreSessionPath(routeSegment(sessionId, "sessionId")), body, sessionLifecycleCommandRequestSchema, 202,
    ),
    trashSession: (sessionId, body) => command(
      "POST", trashSessionPath(routeSegment(sessionId, "sessionId")), body, sessionLifecycleCommandRequestSchema, 202,
    ),
    putPreference: (sessionId, body) => command(
      "PUT", preferencePath(routeSegment(sessionId, "sessionId")), body, preferenceRequestSchema, 202,
    ),
    listFolders(query) {
      const parsed = parseContract(query, folderListQuerySchema);
      return request({ method: "GET", path: withQuery(foldersPath(), parsed) }, 200, folderListSchema);
    },
    createFolder: (body) => command("POST", foldersPath(), body, createFolderRequestSchema, 201),
    updateFolder: (folderId, body) => command(
      "PATCH", folderPath(routeSegment(folderId, "folderId")), body, updateFolderRequestSchema, 202,
    ),
    deleteFolder: (folderId, body) => command(
      "DELETE", folderPath(routeSegment(folderId, "folderId")), body, folderDeleteRequestSchema, 202,
    ),
    openEvents(input) {
      const initialCursor = cursorPolicy.accept(input.cursor);
      if (initialCursor.kind !== "ready") {
        throw new SessionClientError("contract_incompatible", initialCursor.reason);
      }
      const path = eventsPath(routeSegment(input.sessionId, "sessionId"));
      let cursor = initialCursor.cursor;
      let streamEpoch: string | null = null;
      let durableSeq: bigint | null = null;
      let durableEventId: string | null = null;
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
        if (firstConnection) rejectReady(error);
        if (error.kind === "auth_required") input.onConnection({ kind: "auth_required" });
        else if (error.kind === "contract_incompatible") {
          input.onConnection({ kind: "contract_incompatible", reason: error.message });
        } else {
          input.onConnection({
            kind: "repair_required",
            recovery: error.recovery ?? cursorPolicy.onRejected(error.status ?? 500),
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

      const scheduleReconnect = (headers?: Headers): void => {
        if (closed) return;
        input.onConnection({ kind: "reconnecting" });
        const cap = Math.min(reconnectMaxDelayMs, reconnectDelayMs * 2 ** Math.min(reconnectAttempt, 20));
        const delay = retryAfterMs(headers) ?? Math.floor(random() * (cap + 1));
        reconnectAttempt += 1;
        retryTimer = setTimeout(() => {
          retryTimer = null;
          void connect();
        }, delay);
      };

      const connect = async (): Promise<void> => {
        if (closed) return;
        controller = new AbortController();
        input.onConnection({ kind: firstConnection ? "connecting" : "reconnecting" });
        let response: SessionStreamResponse;
        try {
          response = await options.transport.stream({
            method: "GET",
            path,
            headers: { accept: "text/event-stream", [LAST_EVENT_ID_HEADER]: cursor },
            signal: controller.signal,
          });
        } catch (error) {
          if (closed) return;
          if (firstConnection) fail(new SessionClientError("network", `GET ${path} failed`, { cause: error }));
          else scheduleReconnect();
          return;
        }
        const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
        if (response.status !== 200 || response.body === null || contentType !== "text/event-stream") {
          if (!firstConnection && [429, 502, 503, 504].includes(response.status)) scheduleReconnect(response.headers);
          else fail(responseError("GET", path, response, cursorPolicy));
          return;
        }
        input.onConnection({ kind: "live" });
        if (firstConnection) {
          firstConnection = false;
          resolveReady();
        }

        let terminalError: SessionClientError | null = null;
        let draining = false;
        const parser = createSseParser((frame) => {
          if (frame.data === null || frame.event === null) return;
          let raw: unknown;
          try {
            raw = JSON.parse(frame.data);
          } catch (error) {
            throw new SessionClientError("protocol", "SSE data is not JSON", { cause: error });
          }
          const parsed = parseContract(raw, sessionStreamFrameSchema);
          if (parsed.kind !== frame.event || parsed.session_id !== input.sessionId) {
            throw new SessionClientError("contract_incompatible", "SSE identity mismatch");
          }
          if (parsed.kind === "stream.draining") {
            if (frame.id !== null) throw new SessionClientError("protocol", "Control frame advanced durable cursor");
            const accepted = cursorPolicy.accept(parsed.last_durable_cursor);
            if (accepted.kind !== "ready") throw new SessionClientError("contract_incompatible", accepted.reason);
            if (streamEpoch !== null && parsed.stream_epoch !== streamEpoch) {
              throw new SessionClientError("contract_incompatible", "SSE epoch mismatch");
            }
            cursor = accepted.cursor;
            draining = true;
            input.onConnection({ kind: "draining", control: parsed });
            controller?.abort();
            return;
          }
          const accepted = cursorPolicy.accept(frame.id);
          if (accepted.kind !== "ready" || frame.id !== parsed.cursor) {
            throw new SessionClientError("contract_incompatible", "SSE cursor mismatch");
          }
          const nextSeq = BigInt(parsed.durable_seq);
          const exactReplay = durableSeq !== null &&
            nextSeq === durableSeq &&
            parsed.cursor === cursor &&
            parsed.event_id === durableEventId;
          if (
            streamEpoch !== null && parsed.stream_epoch !== streamEpoch ||
            durableSeq !== null && !exactReplay && nextSeq !== durableSeq + 1n
          ) {
            throw new SessionClientError("contract_incompatible", "SSE durable order mismatch");
          }
          streamEpoch = parsed.stream_epoch;
          durableSeq = nextSeq;
          durableEventId = parsed.event_id;
          cursor = accepted.cursor;
          reconnectAttempt = 0;
          input.onEvent(parsed, cursor);
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
        else scheduleReconnect(response.headers);
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
