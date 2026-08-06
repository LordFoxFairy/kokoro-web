import {
  errorEnvelopeSchema,
  SESSION_HTTP_ENDPOINTS,
  sessionHttpContractMetadata,
  sessionStreamFrameSchema,
} from "@kokoro/session-client/contracts";
import { z, type ZodType } from "zod";

import type {
  SessionAccessGrant,
  SessionAccessManager,
  SessionGrantResource,
  SessionPurpose,
} from "./session-access.js";
import {
  createSessionProxy,
  SessionProxyError,
  type BrowserRequestVerificationPort,
  type BrowserSessionRequest,
  type SessionProxyMethod,
  type SessionProxyRoute,
  type SessionProxyTransportPort,
  type SessionSseFrameValidator,
  type SessionUpstreamResponse,
} from "./session-proxy.js";
import type { SiteBootstrap } from "./site-binding.js";

export type SessionBrowserV3OperationId = keyof typeof SESSION_HTTP_ENDPOINTS;
export const SESSION_BROWSER_V3_OPERATION_IDS = Object.freeze(
  Object.keys(SESSION_HTTP_ENDPOINTS) as SessionBrowserV3OperationId[],
);

const SESSION_BROWSER_V3_PURPOSES = Object.freeze({
  createSession: "write",
  listSessions: "read",
  snapshot: "read",
  stream: "stream",
  submitMessage: "write",
  editMessage: "write",
  regenerateMessage: "write",
  forkBranch: "write",
  activateBranch: "write",
  cancelRun: "control",
  decideAction: "control",
  decidePlan: "control",
  getCommandReceipt: "read",
  updateSession: "write",
  archiveSession: "write",
  restoreSession: "write",
  trashSession: "write",
  putPreference: "write",
  listFolders: "read",
  createFolder: "write",
  updateFolder: "write",
  deleteFolder: "write",
} as const satisfies Readonly<Record<SessionBrowserV3OperationId, SessionPurpose>>);
const noValueSchema = z.union([z.undefined(), z.null(), z.object({}).strict()]);
const pathParameterRecordSchema = z.record(z.string(), z.string().min(1).max(128));
const queryValueSchema = z.union([z.string(), z.number().finite(), z.boolean()]);
const queryRecordSchema = z.record(z.string(), queryValueSchema);
const normalizedInputSchema = z.object({
  pathParameters: pathParameterRecordSchema,
  query: queryRecordSchema,
  bodyJson: z.string().nullable(),
}).strict();

const JSON_LIMIT_BYTES = 2_097_152;
const PROBLEM_LIMIT_BYTES = 131_072;
const SSE_FRAME_LIMIT_BYTES = 524_288;
const SSE_CHUNK_LIMIT_BYTES = 262_144;
const SSE_BUFFER_LIMIT_BYTES = 1_048_576;
const OPAQUE_CURSOR_MAX_BYTES = 8_192;
const encoder = new TextEncoder();

type GeneratedEndpoint = (typeof SESSION_HTTP_ENDPOINTS)[SessionBrowserV3OperationId];
type QueryValue = z.infer<typeof queryValueSchema>;

export interface SessionBrowserV3OperationInput {
  readonly pathParameters: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, QueryValue>>;
  readonly bodyJson: string | null;
}

export interface MatchedSessionBrowserV3Request {
  readonly operationId: SessionBrowserV3OperationId;
  readonly pathParameters: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface SessionBrowserV3HttpRequest {
  readonly operationId: SessionBrowserV3OperationId;
  readonly method: SessionProxyMethod;
  /** Contract-relative path rendered from the generated endpoint template. */
  readonly pathname: string;
  /** Canonical query without a leading question mark. */
  readonly query: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly authorization: Readonly<{
    readonly scheme: "Bearer";
    readonly credential: string;
    readonly grantRef: string;
    readonly audience: string;
  }>;
  /** Exact Platform-signed grant binding already verified by the BFF trust kernel. */
  readonly expectedBinding: SessionUpstreamResponse["binding"];
  readonly signal: AbortSignal;
}

export interface AuthenticatedSessionBrowserV3HttpResponse {
  readonly status: number;
  readonly headers: Headers | Readonly<Record<string, string>>;
  readonly body: ReadableStream<Uint8Array> | null;
  /** Supplied by the authenticated server transport, never parsed from HTTP response headers. */
  readonly authenticatedBinding: SessionUpstreamResponse["binding"];
}

export interface AuthenticatedSessionBrowserV3HttpPort {
  send(request: SessionBrowserV3HttpRequest): Promise<AuthenticatedSessionBrowserV3HttpResponse>;
}

function endpointFor(operationId: string): GeneratedEndpoint {
  if (!Object.hasOwn(SESSION_HTTP_ENDPOINTS, operationId)) {
    throw new SessionProxyError("REQUEST_INVALID");
  }
  return SESSION_HTTP_ENDPOINTS[operationId as SessionBrowserV3OperationId];
}

type CompiledBrowserRoute = Readonly<{
  operationId: SessionBrowserV3OperationId;
  method: SessionProxyMethod;
  parameterNames: readonly string[];
  pathname: RegExp;
}>;

function compileBrowserRoute(operationId: SessionBrowserV3OperationId): CompiledBrowserRoute {
  const endpoint = SESSION_HTTP_ENDPOINTS[operationId];
  const parameterNames: string[] = [];
  const pattern = endpoint.path.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
    .replace(/\\\{([A-Za-z0-9_]+)\\\}/gu, (_marker, name: string) => {
      parameterNames.push(name);
      return "([^/]+)";
    });
  return Object.freeze({
    operationId,
    method: endpoint.method,
    parameterNames: Object.freeze(parameterNames),
    pathname: new RegExp(`^${pattern}$`, "u"),
  });
}

const COMPILED_BROWSER_ROUTES = Object.freeze(
  SESSION_BROWSER_V3_OPERATION_IDS.map(compileBrowserRoute),
);

/** Exact generated-registry matcher for same-origin framework adapters. */
export function matchSessionBrowserV3Request(input: Readonly<{
  method: string;
  pathname: string;
  searchParams: URLSearchParams;
}>): MatchedSessionBrowserV3Request {
  const method = input.method.toUpperCase();
  const matches = COMPILED_BROWSER_ROUTES.flatMap((route) => {
    if (route.method !== method) return [];
    const match = route.pathname.exec(input.pathname);
    return match === null ? [] : [{ route, captures: match.slice(1) }];
  });
  if (matches.length !== 1) throw new SessionProxyError("REQUEST_INVALID");
  const matched = matches[0];
  if (matched === undefined) throw new SessionProxyError("REQUEST_INVALID");
  const pathParameters: Record<string, string> = {};
  try {
    matched.route.parameterNames.forEach((name, index) => {
      const value = matched.captures[index];
      if (value === undefined) throw new SessionProxyError("REQUEST_INVALID");
      pathParameters[name] = decodeURIComponent(value);
    });
  } catch (error) {
    if (error instanceof SessionProxyError) throw error;
    throw new SessionProxyError("REQUEST_INVALID");
  }
  const query: Record<string, string> = {};
  for (const [name, value] of input.searchParams.entries()) {
    if (Object.hasOwn(query, name)) throw new SessionProxyError("REQUEST_INVALID");
    query[name] = value;
  }
  return Object.freeze({
    operationId: matched.route.operationId,
    pathParameters: Object.freeze(pathParameters),
    query: Object.freeze(query),
  });
}

function parseNoValue(value: unknown): void {
  noValueSchema.parse(value);
}

function asPlainRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new SessionProxyError("REQUEST_INVALID");
  }
  return value as Readonly<Record<string, unknown>>;
}

function normalizePathParameters(endpoint: GeneratedEndpoint, value: unknown): Readonly<Record<string, string>> {
  if (endpoint.pathSchema === null) {
    parseNoValue(value);
    return Object.freeze({});
  }
  return Object.freeze({ ...pathParameterRecordSchema.parse(endpoint.pathSchema.parse(value)) });
}

function normalizeQuery(endpoint: GeneratedEndpoint, value: unknown): Readonly<Record<string, QueryValue>> {
  if (endpoint.querySchema === null) {
    parseNoValue(value);
    return Object.freeze({});
  }
  const parsed = asPlainRecord(endpoint.querySchema.parse(value ?? {}));
  const normalized = queryRecordSchema.parse(parsed);
  for (const cursor of [normalized.after, normalized.cursor]) {
    if (typeof cursor !== "string") continue;
    try {
      assertOpaqueCursor(cursor);
    } catch {
      throw new SessionProxyError("REQUEST_INVALID");
    }
  }
  return Object.freeze({ ...normalized });
}

function normalizeBody(endpoint: GeneratedEndpoint, value: unknown): string | null {
  if (endpoint.requestSchema === null) {
    parseNoValue(value);
    return null;
  }
  const parsed = endpoint.requestSchema.parse(value);
  const body = JSON.stringify(parsed);
  if (body === undefined || encoder.encode(body).byteLength > JSON_LIMIT_BYTES) {
    throw new SessionProxyError("REQUEST_INVALID");
  }
  return body;
}

function normalizedOperationInput(
  endpoint: GeneratedEndpoint,
  request: {
    readonly pathParameters: unknown;
    readonly query: unknown;
    readonly body: unknown;
  },
): SessionBrowserV3OperationInput {
  try {
    return Object.freeze({
      pathParameters: normalizePathParameters(endpoint, request.pathParameters),
      query: normalizeQuery(endpoint, request.query),
      bodyJson: normalizeBody(endpoint, request.body),
    });
  } catch (error) {
    if (error instanceof SessionProxyError) throw error;
    throw new SessionProxyError("REQUEST_INVALID");
  }
}

function assertOpaqueCursor(value: string): void {
  if (
    value.trim() !== value ||
    value.length === 0 ||
    /^\d+$/u.test(value) ||
    encoder.encode(value).byteLength > OPAQUE_CURSOR_MAX_BYTES ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 33 || code === 127;
    })
  ) {
    throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
}

function responseParser(operationId: SessionBrowserV3OperationId, schema: ZodType) {
  return (value: unknown): unknown => {
    const parsed: unknown = schema.parse(value);
    if (operationId === "snapshot") {
      const snapshot = asPlainRecord(parsed);
      const presentation = asPlainRecord(snapshot.presentation_snapshot);
      if (typeof presentation.cursor !== "string") throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      assertOpaqueCursor(presentation.cursor);
    }
    return parsed;
  };
}

function jsonContract(schema: ZodType, maximumBytes: number, contentType: string) {
  return Object.freeze({
    kind: "json" as const,
    contentTypes: Object.freeze([contentType]),
    maximumBytes,
    parse: (value: unknown) => schema.parse(value),
  });
}

function routeSuccess(
  operationId: SessionBrowserV3OperationId,
  endpoint: GeneratedEndpoint,
): SessionProxyRoute<SessionBrowserV3OperationInput>["success"] {
  let response: SessionProxyRoute<SessionBrowserV3OperationInput>["success"]["response"];
  if (operationId === "stream") {
    response = Object.freeze({
      kind: "sse",
      maximumEmittedFrameBytes: SSE_FRAME_LIMIT_BYTES,
      maximumUpstreamChunkBytes: SSE_CHUNK_LIMIT_BYTES,
      maximumBufferedBytes: SSE_BUFFER_LIMIT_BYTES,
      createValidator: ({ input, headers }) => {
        const normalized = normalizedInputSchema.parse(input);
        const sessionId = normalized.pathParameters.session_id;
        const headerCursor = headers["last-event-id"];
        const queryCursor = normalized.query.after;
        if (
          typeof sessionId !== "string" ||
          queryCursor !== undefined && typeof queryCursor !== "string" ||
          headerCursor !== undefined && queryCursor !== undefined && headerCursor !== queryCursor
        ) {
          throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
        }
        const initialCursor = headerCursor ?? queryCursor;
        if (initialCursor === undefined) throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
        return createSessionBrowserV3SseFrameValidator({ sessionId, initialCursor });
      },
    });
  } else {
    if (endpoint.responseSchema === null) throw new SessionProxyError("REQUEST_INVALID");
    response = Object.freeze({
      ...jsonContract(endpoint.responseSchema, JSON_LIMIT_BYTES, "application/json"),
      parse: responseParser(operationId, endpoint.responseSchema),
    });
  }
  return Object.freeze({ status: endpoint.status, response });
}

function createRoute(operationId: SessionBrowserV3OperationId): SessionProxyRoute<SessionBrowserV3OperationInput> {
  const endpoint = SESSION_HTTP_ENDPOINTS[operationId];
  return Object.freeze({
    operationId,
    method: endpoint.method,
    purpose: SESSION_BROWSER_V3_PURPOSES[operationId],
    replaySafety: "idempotent",
    success: routeSuccess(operationId, endpoint),
    problem: jsonContract(errorEnvelopeSchema, PROBLEM_LIMIT_BYTES, "application/problem+json"),
    resource: (input: SessionBrowserV3OperationInput): SessionGrantResource => {
      const sessionRef = input.pathParameters.session_id;
      const runRef = input.pathParameters.run_id;
      if (runRef !== undefined) {
        if (sessionRef === undefined) throw new SessionProxyError("REQUEST_INVALID");
        return Object.freeze({ kind: "run", sessionRef, runRef });
      }
      if (sessionRef !== undefined) return Object.freeze({ kind: "session", sessionRef });
      return Object.freeze({ kind: "project" });
    },
    parseInput: (request: {
      readonly pathParameters: unknown;
      readonly query: unknown;
      readonly body: unknown;
    }) => normalizedOperationInput(endpoint, request),
  });
}

export const SESSION_BROWSER_V3_ROUTES = Object.freeze(Object.fromEntries(
  SESSION_BROWSER_V3_OPERATION_IDS.map((operationId) => [operationId, createRoute(operationId)]),
)) as Readonly<Record<SessionBrowserV3OperationId, SessionProxyRoute<SessionBrowserV3OperationInput>>>;

if (
  Object.keys(SESSION_BROWSER_V3_PURPOSES).length !== SESSION_BROWSER_V3_OPERATION_IDS.length ||
  Object.keys(SESSION_BROWSER_V3_ROUTES).length !== SESSION_BROWSER_V3_OPERATION_IDS.length
) {
  throw new SessionProxyError("REQUEST_INVALID");
}

function renderPath(template: string, pathParameters: Readonly<Record<string, string>>): string {
  let pathname = template;
  for (const [name, value] of Object.entries(pathParameters)) {
    const marker = `{${name}}`;
    if (!pathname.includes(marker)) throw new SessionProxyError("REQUEST_INVALID");
    pathname = pathname.replace(marker, encodeURIComponent(value));
  }
  if (pathname.includes("{") || pathname.includes("}")) throw new SessionProxyError("REQUEST_INVALID");
  return pathname;
}

function renderQuery(query: Readonly<Record<string, QueryValue>>): string {
  const result = new URLSearchParams();
  for (const name of Object.keys(query).sort()) {
    const value = query[name];
    if (value !== undefined) result.set(name, String(value));
  }
  return result.toString();
}

function expectedAudience(purpose: SessionPurpose): string {
  return `session.${purpose}`;
}

function fullGrantBinding(accessGrant: SessionAccessGrant): SessionUpstreamResponse["binding"] {
  return Object.freeze({
    grantRef: accessGrant.grantRef,
    ...accessGrant.binding,
    purpose: accessGrant.authorization.purpose,
    audience: accessGrant.authorization.audience,
  });
}

function sameBinding(
  expected: SessionUpstreamResponse["binding"],
  actual: SessionUpstreamResponse["binding"],
): boolean {
  const expectedEntries = Object.entries(expected);
  return expectedEntries.length === Object.keys(actual).length &&
    expectedEntries.every(([key, value]) => key === "resource"
      ? JSON.stringify(actual.resource) === JSON.stringify(value)
      : actual[key as keyof typeof actual] === value);
}

function cancelRejectedBody(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  void body.cancel("authenticated grant mismatch").catch(() => undefined);
}

export function createSessionBrowserV3Transport(
  input: AuthenticatedSessionBrowserV3HttpPort,
): SessionProxyTransportPort {
  return Object.freeze({
    async execute(request: {
      readonly operationId: string;
      readonly input: unknown;
      readonly headers: Readonly<Record<string, string>>;
      readonly accessGrant: SessionAccessGrant;
      readonly signal: AbortSignal;
    }) {
      const endpoint = endpointFor(request.operationId);
      const operationId = request.operationId as SessionBrowserV3OperationId;
      const route = SESSION_BROWSER_V3_ROUTES[operationId];
      let pathParameters: Readonly<Record<string, string>>;
      let query: Readonly<Record<string, QueryValue>>;
      let bodyJson: string | null;
      try {
        const normalized = normalizedInputSchema.parse(request.input);
        pathParameters = normalizePathParameters(endpoint, normalized.pathParameters);
        query = normalizeQuery(endpoint, normalized.query);
        bodyJson = normalized.bodyJson === null
          ? normalizeBody(endpoint, undefined)
          : normalizeBody(endpoint, JSON.parse(normalized.bodyJson));
      } catch (error) {
        if (error instanceof SessionProxyError) throw error;
        throw new SessionProxyError("REQUEST_INVALID");
      }
      if (
        request.accessGrant.authorization.purpose !== route.purpose ||
        request.accessGrant.authorization.audience !== expectedAudience(route.purpose)
      ) {
        throw new SessionProxyError("UPSTREAM_BINDING_MISMATCH");
      }
      const lastEventId = request.headers["last-event-id"];
      if (lastEventId !== undefined) {
        if (operationId !== "stream") throw new SessionProxyError("REQUEST_INVALID");
        try {
          assertOpaqueCursor(lastEventId);
        } catch {
          throw new SessionProxyError("REQUEST_INVALID");
        }
      }
      if (
        operationId === "stream" &&
        (lastEventId === undefined && query.after === undefined ||
          lastEventId !== undefined && query.after !== undefined && lastEventId !== query.after)
      ) {
        throw new SessionProxyError("REQUEST_INVALID");
      }
      const expectedBinding = fullGrantBinding(request.accessGrant);
      const response = await input.send({
        operationId,
        method: route.method,
        pathname: renderPath(endpoint.path, pathParameters),
        query: renderQuery(query),
        headers: Object.freeze({
          ...request.headers,
          ...(bodyJson === null ? {} : { "content-type": "application/json" }),
        }),
        body: bodyJson,
        authorization: Object.freeze({
          scheme: "Bearer",
          credential: request.accessGrant.credential,
          grantRef: request.accessGrant.grantRef,
          audience: request.accessGrant.authorization.audience,
        }),
        expectedBinding,
        signal: request.signal,
      });
      const authenticatedBinding = Object.freeze({ ...response.authenticatedBinding });
      if (!sameBinding(expectedBinding, authenticatedBinding)) {
        cancelRejectedBody(response.body);
        throw new SessionProxyError("UPSTREAM_BINDING_MISMATCH");
      }
      return Object.freeze({
        status: response.status,
        headers: response.headers,
        body: response.body,
        binding: authenticatedBinding,
      });
    },
  });
}

type ParsedSseFields = Readonly<{
  event: string;
  id?: string;
  data: string;
}>;

function parseSseFields(frame: string): ParsedSseFields | null {
  let event: string | undefined;
  let id: string | undefined;
  const data: string[] = [];
  let hasField = false;
  for (const line of frame.split(/\r\n|\r|\n/u)) {
    if (line.startsWith(":")) continue;
    if (line.length === 0) continue;
    hasField = true;
    const separator = line.indexOf(":");
    const name = separator < 0 ? line : line.slice(0, separator);
    const raw = separator < 0 ? "" : line.slice(separator + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (name === "event" && event === undefined) event = value;
    else if (name === "id" && id === undefined && !value.includes("\u0000")) id = value;
    else if (name === "data") data.push(value);
    else throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
  if (!hasField) return null;
  if (event === undefined || event.length === 0 || data.length === 0) {
    throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
  return Object.freeze({ event, ...(id === undefined ? {} : { id }), data: data.join("\n") });
}

function boundaryIn(buffer: string): { readonly index: number; readonly length: number } | null {
  let lineStart = 0;
  let previousEndingStart = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    const character = buffer[index];
    if (character !== "\r" && character !== "\n") continue;
    const width = character === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
    if (index === lineStart) {
      return { index: previousEndingStart, length: index + width - previousEndingStart };
    }
    previousEndingStart = index;
    lineStart = index + width;
    index += width - 1;
  }
  return null;
}

export function createSessionBrowserV3SseFrameValidator(input: Readonly<{
  sessionId: string;
  initialCursor: string;
}>): SessionSseFrameValidator {
  if (input.sessionId.trim().length === 0) throw new SessionProxyError("REQUEST_INVALID");
  try {
    assertOpaqueCursor(input.initialCursor);
  } catch {
    throw new SessionProxyError("REQUEST_INVALID");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let streamEpoch: string | null = null;
  let durableSeq: bigint | null = null;
  let durableCursor: string | null = null;
  let durableEventId: string | null = null;

  const validateFrame = (frame: string): Uint8Array | null => {
    const fields = parseSseFields(frame);
    if (fields === null) return encoder.encode(`${frame}\n\n`);
    let raw: unknown;
    try {
      raw = JSON.parse(fields.data);
    } catch {
      throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
    }
    const parsed = sessionStreamFrameSchema.safeParse(raw);
    if (!parsed.success || parsed.data.kind !== fields.event) {
      throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
    }
    if (parsed.data.session_id !== input.sessionId) {
      throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
    }
    if (parsed.data.kind === "stream.draining") {
      if (fields.id !== undefined) throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      assertOpaqueCursor(parsed.data.last_durable_cursor);
      if (
        streamEpoch !== null && parsed.data.stream_epoch !== streamEpoch ||
        parsed.data.last_durable_cursor !== (durableCursor ?? input.initialCursor)
      ) {
        throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      }
    } else {
      if (fields.id === undefined || fields.id !== parsed.data.cursor) {
        throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      }
      assertOpaqueCursor(parsed.data.cursor);
      const nextSeq = BigInt(parsed.data.durable_seq);
      if (streamEpoch !== null && parsed.data.stream_epoch !== streamEpoch) {
        throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      }
      if (durableSeq !== null) {
        const exactReplay = nextSeq === durableSeq &&
          parsed.data.cursor === durableCursor &&
          parsed.data.event_id === durableEventId;
        if (exactReplay) return null;
        if (!exactReplay && nextSeq !== durableSeq + 1n) {
          throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
        }
      }
      streamEpoch = parsed.data.stream_epoch;
      durableSeq = nextSeq;
      durableCursor = parsed.data.cursor;
      durableEventId = parsed.data.event_id;
    }
    return encoder.encode(`${frame}\n\n`);
  };

  const drain = (): readonly Uint8Array[] => {
    const emitted: Uint8Array[] = [];
    for (;;) {
      const boundary = boundaryIn(buffer);
      if (boundary === null) break;
      const frame = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary.length);
      const validated = validateFrame(frame);
      if (validated !== null) emitted.push(validated);
    }
    return emitted;
  };

  return Object.freeze({
    push(chunk: Uint8Array) {
      try {
        buffer += decoder.decode(chunk, { stream: true });
        if (encoder.encode(buffer).byteLength > SSE_FRAME_LIMIT_BYTES) {
          throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
        }
        return drain();
      } catch (error) {
        if (error instanceof SessionProxyError) throw error;
        throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      }
    },
    finish() {
      try {
        buffer += decoder.decode();
        const emitted = drain();
        if (buffer.length !== 0) throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
        return emitted;
      } catch (error) {
        if (error instanceof SessionProxyError) throw error;
        throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      }
    },
  });
}

export function createSessionBrowserV3Proxy(input: {
  readonly bootstrap: SiteBootstrap;
  readonly access: SessionAccessManager;
  readonly transport: SessionProxyTransportPort;
  readonly browserRequestVerifier: BrowserRequestVerificationPort;
}) {
  if (
    sessionHttpContractMetadata.schemaId !== "kokoro.session.browser.v3" ||
    sessionHttpContractMetadata.schemaVersion !== 3
  ) {
    throw new SessionProxyError("REQUEST_INVALID");
  }
  const proxy = createSessionProxy(input);
  return Object.freeze({
    execute(request: {
      readonly operationId: SessionBrowserV3OperationId;
      readonly browser: BrowserSessionRequest;
      readonly projectRef?: string;
    }): Promise<Response> {
      endpointFor(request.operationId);
      return proxy.execute({
        route: SESSION_BROWSER_V3_ROUTES[request.operationId],
        browser: request.browser,
        projectRef: request.projectRef,
      });
    },
  });
}
