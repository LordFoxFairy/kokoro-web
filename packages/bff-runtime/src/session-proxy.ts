import { SESSION_HTTP_ENDPOINTS } from "@kokoro/session-client/contracts";

import type { SessionAccessGrant, SessionAccessManager, SessionPurpose } from "./session-access.js";
import {
  validatedSiteBootstrap,
  type RuntimeEnvironment,
  type SiteBootstrap,
} from "./site-binding.js";

const AUTHORITY_KEYS = new Set([
  "authorization",
  "bearer",
  "credential",
  "deploymentref",
  "grant",
  "grantref",
  "identitysessionref",
  "namespace",
  "policyepoch",
  "productcontextref",
  "rawsessionbearer",
  "revocationepoch",
  "sessionaccessgrant",
  "siteid",
  "siteref",
  "siteprojectbinding",
  "subjectgeneration",
  "workloadcredential",
]);

export type SessionProxyMethod = (typeof SESSION_HTTP_ENDPOINTS)[keyof typeof SESSION_HTTP_ENDPOINTS]["method"];
const SESSION_PROXY_METHODS = new Set<SessionProxyMethod>(
  Object.values(SESSION_HTTP_ENDPOINTS).map((endpoint) => endpoint.method),
);

const UPSTREAM_REQUEST_HEADERS = new Set([
  "accept",
  "last-event-id",
]);
const VERIFICATION_REQUEST_HEADERS = new Set([
  "content-type",
  "origin",
  "sec-fetch-site",
  "x-csrf-token",
]);
const ALLOWED_BROWSER_HEADERS = new Set([...UPSTREAM_REQUEST_HEADERS, ...VERIFICATION_REQUEST_HEADERS]);
const SAFE_RESPONSE_HEADERS = new Set([
  "cache-control",
  "content-language",
  "content-type",
  "retry-after",
  "vary",
]);

function hasControl(value: string, includeSpace: boolean): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < (includeSpace ? 33 : 32) || code === 127;
  });
}

export class SessionProxyError extends Error {
  constructor(
    readonly code:
      | "BROWSER_AUTHORITY_FORBIDDEN"
      | "BROWSER_HEADER_FORBIDDEN"
      | "BROWSER_REQUEST_UNVERIFIED"
      | "REQUEST_INVALID"
      | "UPSTREAM_BINDING_MISMATCH"
      | "UPSTREAM_PROTOCOL_ERROR",
  ) {
    super(`Session proxy rejected: ${code}`);
    this.name = "SessionProxyError";
  }
}

export class SessionAccessRejectedError extends Error {
  constructor(readonly reason: "expired_before_effect" | "revoked" | "forbidden") {
    super("Session access was rejected");
    this.name = "SessionAccessRejectedError";
  }
}

export interface BrowserSessionRequest {
  readonly method: string;
  readonly headers?: Headers | Readonly<Record<string, string>>;
  readonly pathParameters?: unknown;
  readonly query?: unknown;
  readonly body?: unknown;
  readonly signal?: AbortSignal;
}

export interface BrowserRequestVerificationPort {
  /** Must verify origin/fetch metadata for every browser request and CSRF for every mutation. */
  verify(input: {
    readonly operationId: string;
    readonly method: SessionProxyMethod;
    readonly headers: Readonly<Record<string, string>>;
  }): Promise<BrowserRequestProof> | BrowserRequestProof;
}

export type BrowserRequestProof = Readonly<{
  readonly kind: "same-origin-browser";
  readonly operationId: string;
  readonly method: SessionProxyMethod;
  readonly origin: string;
}>;

export interface CsrfVerificationPort {
  verify(input: { readonly operationId: string; readonly token: string }): Promise<boolean> | boolean;
}

function normalizeOrigin(value: string, runtimeEnvironment: RuntimeEnvironment): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
  }
  if (url.origin !== value || url.username !== "" || url.password !== "") {
    throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
  }
  if (url.protocol !== "https:" && runtimeEnvironment !== "development") {
    throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
  }
  return url.origin;
}

export function createOriginCsrfBrowserRequestVerifier(input: {
  readonly runtimeEnvironment: RuntimeEnvironment;
  readonly allowedOrigins: readonly string[];
  readonly csrf: CsrfVerificationPort;
}): BrowserRequestVerificationPort {
  const allowedOrigins = new Set(
    input.allowedOrigins.map((origin) => normalizeOrigin(origin, input.runtimeEnvironment)),
  );
  if (allowedOrigins.size === 0 || allowedOrigins.size !== input.allowedOrigins.length) {
    throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
  }
  return Object.freeze({
    async verify(request: Parameters<BrowserRequestVerificationPort["verify"]>[0]) {
      const origin = request.headers.origin;
      const fetchSite = request.headers["sec-fetch-site"];
      if (
        origin === undefined ||
        !allowedOrigins.has(origin) ||
        fetchSite !== "same-origin"
      ) {
        throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
      }
      const proof = Object.freeze({
        kind: "same-origin-browser" as const,
        operationId: request.operationId,
        method: request.method,
        origin,
      });
      if (request.method === "GET") return proof;
      const token = request.headers["x-csrf-token"];
      if (
        token === undefined ||
        token.length < 32 ||
        token.length > 512 ||
        hasControl(token, true) ||
        !(await input.csrf.verify({ operationId: request.operationId, token }))
      ) {
        throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
      }
      return proof;
    },
  });
}

export interface SessionSseFrameValidator {
  /** Returns only complete, contract-valid encoded SSE frames. */
  push(chunk: Uint8Array): readonly Uint8Array[];
  /** Rejects incomplete/invalid terminal state and returns any final validated frames. */
  finish(): readonly Uint8Array[];
}

export type SessionResponseContract =
  | Readonly<{
      kind: "json";
      contentTypes: readonly string[];
      maximumBytes: number;
      parse: (input: unknown) => unknown;
    }>
  | Readonly<{
      kind: "sse";
      maximumEmittedFrameBytes: number;
      maximumUpstreamChunkBytes: number;
      maximumBufferedBytes: number;
      createValidator: (context: Readonly<{
        operationId: string;
        input: unknown;
        headers: Readonly<Record<string, string>>;
      }>) => SessionSseFrameValidator;
    }>
  | Readonly<{ kind: "empty" }>;

export interface SessionProxyRoute<Input = unknown> {
  readonly operationId: string;
  readonly method: SessionProxyMethod;
  readonly purpose: SessionPurpose;
  readonly replaySafety: "idempotent" | "unsafe";
  /** The sole successful status and schema come from the generated operation registry. */
  readonly success: Readonly<{ readonly status: number; readonly response: SessionResponseContract }>;
  /** Every non-success HTTP response is a bounded generated problem envelope. */
  readonly problem: Extract<SessionResponseContract, { kind: "json" }>;
  /** Generated Session adapters supply validation and operation-bound input construction here. */
  readonly parseInput: (request: {
    readonly pathParameters: unknown;
    readonly query: unknown;
    readonly body: unknown;
  }) => Input;
}

export interface SessionUpstreamResponse {
  readonly status: number;
  readonly headers: Headers | Readonly<Record<string, string>>;
  readonly body: ReadableStream<Uint8Array> | null;
  /** Authenticated transport metadata, never derived from response headers. */
  readonly binding: Readonly<{
    readonly grantRef: string;
    readonly productContextRef: string;
    readonly siteProjectBindingRef: string;
    readonly deploymentRef: string;
    readonly siteRef: string;
    readonly siteReleaseRef: string;
    readonly webArtifactDigest: string;
    readonly runtimeEnvironment: string;
    readonly region: string;
    readonly sessionContractRevision: string;
    readonly projectRef: string;
    readonly subjectRef: string;
    readonly subjectGeneration: string;
    readonly identitySessionRef: string;
    readonly policyEpoch: string;
    readonly revocationEpoch: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly purpose: string;
    readonly audience: string;
  }>;
}

export interface TrustedServerSessionTransportPort {
  /** Server-internal port: the adapter owns a registered endpoint and an OOB-authenticated grant binding. */
  execute<Input>(request: {
    readonly operationId: string;
    readonly input: Input;
    readonly headers: Readonly<Record<string, string>>;
    readonly accessGrant: SessionAccessGrant;
    readonly signal: AbortSignal;
  }): Promise<SessionUpstreamResponse>;
}

export type SessionProxyTransportPort = TrustedServerSessionTransportPort;

function normalizedAuthorityKey(key: string): string {
  return key.toLowerCase().replaceAll(/[-_]/gu, "");
}

function assertNoBrowserAuthority(input: unknown): void {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    nodes += 1;
    if (nodes > 10_000 || depth > 32) throw new SessionProxyError("REQUEST_INVALID");
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) throw new SessionProxyError("REQUEST_INVALID");
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new SessionProxyError("REQUEST_INVALID");
    }
    for (const [key, child] of Object.entries(value as Readonly<Record<string, unknown>>)) {
      if (AUTHORITY_KEYS.has(normalizedAuthorityKey(key))) {
        throw new SessionProxyError("BROWSER_AUTHORITY_FORBIDDEN");
      }
      visit(child, depth + 1);
    }
  };
  try {
    visit(input, 0);
  } catch (error) {
    if (error instanceof SessionProxyError) throw error;
    throw new SessionProxyError("REQUEST_INVALID");
  }
}

function headerEntries(headers: BrowserSessionRequest["headers"]): readonly (readonly [string, string])[] {
  if (headers === undefined) return [];
  if (headers instanceof Headers) return [...headers.entries()];
  return Object.entries(headers);
}

function collectBrowserHeaders(headers: BrowserSessionRequest["headers"]): Readonly<Record<string, string>> {
  const accepted: Record<string, string> = {};
  for (const [rawName, rawValue] of headerEntries(headers)) {
    const name = rawName.toLowerCase();
    if (
      !ALLOWED_BROWSER_HEADERS.has(name) ||
      rawValue.length > 4096 ||
      hasControl(rawValue, false)
    ) {
      throw new SessionProxyError("BROWSER_HEADER_FORBIDDEN");
    }
    accepted[name] = rawValue;
  }
  return Object.freeze(accepted);
}

function upstreamHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(headers).filter(([name]) => UPSTREAM_REQUEST_HEADERS.has(name)),
  ));
}

function filterResponseHeaders(headers: SessionUpstreamResponse["headers"]): Headers {
  const source = headers instanceof Headers ? headers : new Headers(headers);
  const safe = new Headers();
  for (const [name, value] of source.entries()) {
    if (SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) safe.set(name, value);
  }
  return safe;
}

function discard(body: ReadableStream<Uint8Array> | null): void {
  if (body === null) return;
  void body.cancel("Session BFF rejected upstream response").catch(() => {
    // The response is already rejected; cancellation is best effort.
  });
}

function forwardValidatedSse(
  body: ReadableStream<Uint8Array>,
  validator: SessionSseFrameValidator,
  maximumEmittedFrameBytes: number,
  maximumUpstreamChunkBytes: number,
  maximumBufferedBytes: number,
  upstreamAbort: AbortController,
  cleanup: () => void,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let finished = false;
  const appendValidated = (frames: readonly Uint8Array[]): void => {
    for (const frame of frames) {
      if (
        !(frame instanceof Uint8Array) ||
        frame.byteLength === 0 ||
        frame.byteLength > maximumEmittedFrameBytes ||
        pendingBytes + frame.byteLength > maximumBufferedBytes
      ) {
        throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      }
      pending.push(frame);
      pendingBytes += frame.byteLength;
    }
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        while (pending.length === 0 && !finished) {
          const result = await reader.read();
          if (result.done) {
            finished = true;
            appendValidated(validator.finish());
            break;
          }
          if (result.value.byteLength > maximumUpstreamChunkBytes) {
            throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
          }
          appendValidated(validator.push(result.value));
        }
        const frame = pending.shift();
        if (frame !== undefined) {
          pendingBytes -= frame.byteLength;
          controller.enqueue(frame);
        }
        else if (finished) {
          cleanup();
          controller.close();
        }
      } catch (error) {
        finished = true;
        cleanup();
        upstreamAbort.abort(error);
        void reader.cancel(error).catch(() => undefined);
        controller.error(error instanceof SessionProxyError
          ? error
          : new SessionProxyError("UPSTREAM_PROTOCOL_ERROR"));
      }
    },
    async cancel(reason) {
      if (!finished) upstreamAbort.abort(reason);
      finished = true;
      cleanup();
      try {
        await reader.cancel(reason);
      } catch {
        // Downstream cancellation is already terminal.
      }
    },
  });
}

function assertUpstreamBinding(
  response: SessionUpstreamResponse,
  bootstrap: SiteBootstrap,
  grant: SessionAccessGrant,
): void {
  const actual = response.binding;
  const expected = grant.binding;
  if (
    actual.grantRef !== grant.grantRef ||
    actual.productContextRef !== bootstrap.productContextRef ||
    actual.productContextRef !== expected.productContextRef ||
    actual.siteProjectBindingRef !== expected.siteProjectBindingRef ||
    actual.deploymentRef !== expected.deploymentRef ||
    actual.siteRef !== expected.siteRef ||
    actual.siteReleaseRef !== expected.siteReleaseRef ||
    actual.webArtifactDigest !== expected.webArtifactDigest ||
    actual.runtimeEnvironment !== expected.runtimeEnvironment ||
    actual.region !== expected.region ||
    actual.sessionContractRevision !== expected.sessionContractRevision ||
    actual.projectRef !== expected.projectRef ||
    actual.subjectRef !== expected.subjectRef ||
    actual.subjectGeneration !== expected.subjectGeneration ||
    actual.identitySessionRef !== expected.identitySessionRef ||
    actual.policyEpoch !== expected.policyEpoch ||
    actual.revocationEpoch !== expected.revocationEpoch ||
    actual.issuedAt !== expected.issuedAt ||
    actual.expiresAt !== expected.expiresAt ||
    actual.purpose !== grant.authorization.purpose ||
    actual.audience !== grant.authorization.audience
  ) {
    throw new SessionProxyError("UPSTREAM_BINDING_MISMATCH");
  }
}

function responseContract(
  response: SessionUpstreamResponse,
  route: SessionProxyRoute,
): SessionResponseContract {
  if (!Number.isInteger(response.status)) throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  const contract = response.status === route.success.status
    ? route.success.response
    : response.status >= 400 && response.status <= 599
      ? route.problem
      : undefined;
  if (contract === undefined) throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  const headers = response.headers instanceof Headers ? response.headers : new Headers(response.headers);
  const contentType = headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (contract.kind === "sse" && contentType !== "text/event-stream") {
    throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
  if (contract.kind === "json" && !contract.contentTypes.includes(contentType)) {
    throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
  if (contract.kind === "empty" && response.body !== null) {
    throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
  if (contract.kind !== "empty" && response.body === null) {
    throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
  return contract;
}

function assertRouteDefinition(route: SessionProxyRoute): void {
  const contracts = [route.success.response, route.problem] as const;
  if (
    route.operationId.trim().length === 0 ||
    route.operationId.length > 128 ||
    !SESSION_PROXY_METHODS.has(route.method) ||
    !["read", "write", "control", "stream"].includes(route.purpose) ||
    !["idempotent", "unsafe"].includes(route.replaySafety) ||
    !Number.isInteger(route.success.status) ||
    route.success.status < 200 ||
    route.success.status > 299 ||
    route.problem.kind !== "json" ||
    typeof route.parseInput !== "function"
  ) {
    throw new SessionProxyError("REQUEST_INVALID");
  }
  for (const contract of contracts) {
    if (
      (contract.kind === "json" && (
        contract.maximumBytes < 1 ||
        contract.maximumBytes > 2_097_152 ||
        contract.contentTypes.length === 0 ||
        typeof contract.parse !== "function"
      )) ||
      (contract.kind === "sse" && (
        contract.maximumEmittedFrameBytes < 1 ||
        contract.maximumEmittedFrameBytes > 1_048_576 ||
        contract.maximumUpstreamChunkBytes < 1 ||
        contract.maximumUpstreamChunkBytes > 1_048_576 ||
        contract.maximumBufferedBytes < contract.maximumEmittedFrameBytes ||
        contract.maximumBufferedBytes > 4_194_304 ||
        typeof contract.createValidator !== "function"
      ))
    ) {
      throw new SessionProxyError("REQUEST_INVALID");
    }
  }
  if (
    route.success.response.kind === "sse" &&
    (route.method !== "GET" || route.replaySafety !== "idempotent" || route.purpose !== "stream")
  ) {
    throw new SessionProxyError("REQUEST_INVALID");
  }
}

async function parseJsonResponse(
  body: ReadableStream<Uint8Array>,
  contract: Extract<SessionResponseContract, { kind: "json" }>,
): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > contract.maximumBytes) throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      chunks.push(result.value);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(merged);
    const parsed: unknown = JSON.parse(decoded);
    const validated = contract.parse(parsed);
    const encoded = JSON.stringify(validated);
    if (encoded === undefined || new TextEncoder().encode(encoded).byteLength > contract.maximumBytes) {
      throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
    }
    return encoded;
  } catch (error) {
    void reader.cancel(error).catch(() => undefined);
    if (error instanceof SessionProxyError) throw error;
    throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
  }
}

export function createSessionProxy(input: {
  readonly bootstrap: SiteBootstrap;
  readonly access: SessionAccessManager;
  readonly transport: TrustedServerSessionTransportPort;
  readonly browserRequestVerifier: BrowserRequestVerificationPort;
}) {
  const bootstrap = validatedSiteBootstrap(input.bootstrap);

  async function execute<Input>(request: {
    readonly route: SessionProxyRoute<Input>;
    readonly browser: BrowserSessionRequest;
    readonly projectRef?: string;
  }): Promise<Response> {
    assertRouteDefinition(request.route);
    if (request.browser.method.toUpperCase() !== request.route.method) {
      throw new SessionProxyError("REQUEST_INVALID");
    }
    const browserHeaders = collectBrowserHeaders(request.browser.headers);
    try {
      const proof = await input.browserRequestVerifier.verify({
        operationId: request.route.operationId,
        method: request.route.method,
        headers: browserHeaders,
      });
      if (
        proof.kind !== "same-origin-browser" ||
        proof.operationId !== request.route.operationId ||
        proof.method !== request.route.method ||
        browserHeaders.origin !== proof.origin
      ) {
        throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
      }
    } catch (error) {
      if (error instanceof SessionProxyError) throw error;
      throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED");
    }
    assertNoBrowserAuthority(request.browser.pathParameters);
    assertNoBrowserAuthority(request.browser.query);
    assertNoBrowserAuthority(request.browser.body);
    let routeInput: Input;
    try {
      routeInput = request.route.parseInput({
        pathParameters: request.browser.pathParameters,
        query: request.browser.query,
        body: request.browser.body,
      });
    } catch {
      throw new SessionProxyError("REQUEST_INVALID");
    }

    const upstreamAbort = new AbortController();
    const abortFromBrowser = () => upstreamAbort.abort(request.browser.signal?.reason);
    if (request.browser.signal?.aborted === true) abortFromBrowser();
    else request.browser.signal?.addEventListener("abort", abortFromBrowser, { once: true });
    const cleanup = () => request.browser.signal?.removeEventListener("abort", abortFromBrowser);

    const call = async (forceRefresh: boolean): Promise<{
      readonly response: SessionUpstreamResponse;
      readonly grant: SessionAccessGrant;
    }> => {
      const grant = await input.access.acquire({
        purpose: request.route.purpose,
        projectRef: request.projectRef,
        forceRefresh,
      });
      const response = await input.transport.execute({
        operationId: request.route.operationId,
        input: routeInput,
        headers: upstreamHeaders(browserHeaders),
        accessGrant: grant,
        signal: upstreamAbort.signal,
      });
      return { response, grant };
    };

    try {
      let result: Awaited<ReturnType<typeof call>>;
      try {
        result = await call(false);
      } catch (error) {
        if (
          error instanceof SessionAccessRejectedError &&
          error.reason === "expired_before_effect" &&
          request.route.replaySafety === "idempotent" &&
          !upstreamAbort.signal.aborted
        ) {
          result = await call(true);
        } else {
          throw error;
        }
      }
      let contract: SessionResponseContract;
      try {
        assertUpstreamBinding(result.response, bootstrap, result.grant);
        contract = responseContract(result.response, request.route);
      } catch (error) {
        discard(result.response.body);
        throw error;
      }
      const responseHeaders = filterResponseHeaders(result.response.headers);
      if (contract.kind === "empty") {
        cleanup();
        return new Response(null, { status: result.response.status, headers: responseHeaders });
      }
      const body = result.response.body;
      if (body === null) throw new SessionProxyError("UPSTREAM_PROTOCOL_ERROR");
      if (contract.kind === "json") {
        const json = await parseJsonResponse(body, contract);
        cleanup();
        responseHeaders.delete("etag");
        responseHeaders.delete("last-modified");
        responseHeaders.set("cache-control", "no-store");
        responseHeaders.set("content-type", `${contract.contentTypes[0]}; charset=utf-8`);
        return new Response(json, { status: result.response.status, headers: responseHeaders });
      }
      responseHeaders.set("cache-control", "no-store, no-transform");
      responseHeaders.set("content-type", "text/event-stream; charset=utf-8");
      responseHeaders.set("x-accel-buffering", "no");
      return new Response(forwardValidatedSse(
        body,
        contract.createValidator({
          operationId: request.route.operationId,
          input: routeInput,
          headers: upstreamHeaders(browserHeaders),
        }),
        contract.maximumEmittedFrameBytes,
        contract.maximumUpstreamChunkBytes,
        contract.maximumBufferedBytes,
        upstreamAbort,
        cleanup,
      ), { status: result.response.status, headers: responseHeaders });
    } catch (error) {
      cleanup();
      upstreamAbort.abort(error);
      throw error;
    }
  }

  return Object.freeze({ execute });
}
