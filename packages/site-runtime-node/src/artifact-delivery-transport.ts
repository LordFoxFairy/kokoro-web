import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { Readable } from "node:stream";

import type {
  ArtifactDeliveryTransport,
  ArtifactDeliveryTransportRequest,
} from "@kokoro/site-client/server";

const MAXIMUM_RANGE_BYTES = 8_388_608n;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,255}$/u;
const ALLOWED_REQUEST_HEADERS = new Set([
  "Kokoro-Contract-Version",
  "Range",
  "X-Kokoro-Request-Deadline-Ms",
]);
const DELIVERY_RESPONSE_HEADERS = new Set([
  "accept-ranges",
  "content-disposition",
  "content-length",
  "content-range",
  "content-type",
  "etag",
  "last-modified",
]);
const MIME_TOKEN = /^[A-Za-z0-9!#$&^_.+-]+$/u;

export type NodeArtifactDeliveryOpenRequest = Readonly<{
  method: "GET";
  path: string;
  headers: Readonly<Record<string, string>>;
  body: null;
  signal: AbortSignal;
  timeoutMs: number;
}>;

export class NodeArtifactDeliveryTransportError extends Error {
  constructor(readonly code: "UPSTREAM_PROTOCOL_INVALID" | "UPSTREAM_TIMEOUT") {
    super(`Node artifact delivery unavailable: ${code}`);
    this.name = "NodeArtifactDeliveryTransportError";
  }
}

function protocol(): never {
  throw new NodeArtifactDeliveryTransportError("UPSTREAM_PROTOCOL_INVALID");
}

function deadline(headers: Readonly<Record<string, string>>, maximum: number): number {
  const raw = headers["X-Kokoro-Request-Deadline-Ms"];
  if (raw === undefined || !/^[1-9][0-9]{0,4}$/u.test(raw)) protocol();
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 30_000) protocol();
  return Math.min(value, maximum);
}

function validateRange(value: string | undefined): void {
  if (value === undefined) return;
  if (value.length > 64) protocol();
  const absolute = /^bytes=([0-9]+)-([0-9]+)$/u.exec(value);
  const suffix = /^bytes=-([1-9][0-9]*)$/u.exec(value);
  if (absolute !== null) {
    const start = BigInt(absolute[1] ?? "0");
    const end = BigInt(absolute[2] ?? "0");
    if (end < start || end - start + 1n > MAXIMUM_RANGE_BYTES) protocol();
    return;
  }
  if (suffix !== null && BigInt(suffix[1] ?? "0") <= MAXIMUM_RANGE_BYTES) return;
  protocol();
}

function validate(request: ArtifactDeliveryTransportRequest, maximumTimeoutMs: number): number {
  const path = /^\/v1\/artifact-delivery-authorizations\/([^/]+)\/content$/u.exec(request.path);
  let canonicalPath = false;
  if (path !== null) {
    try {
      const encoded = path[1] ?? "";
      const decoded = decodeURIComponent(encoded);
      canonicalPath = REFERENCE.test(decoded) && encodeURIComponent(decoded) === encoded;
    } catch {
      canonicalPath = false;
    }
  }
  if (
    request.method !== "GET" ||
    !canonicalPath ||
    Object.keys(request.headers).some((name) => !ALLOWED_REQUEST_HEADERS.has(name)) ||
    request.security.deliveryCapability.length < 32 ||
    request.security.deliveryCapability.length > 4_096 ||
    Array.from(request.security.deliveryCapability).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 32 || code === 127;
    })
  ) protocol();
  validateRange(request.headers.Range);
  return deadline(request.headers, maximumTimeoutMs);
}

function validMimeType(value: string): boolean {
  const [essence, ...parameters] = value.split(";");
  const slash = essence?.indexOf("/") ?? -1;
  if (
    slash < 1 || slash === (essence?.length ?? 0) - 1 ||
    !MIME_TOKEN.test(essence?.slice(0, slash) ?? "") || !MIME_TOKEN.test(essence?.slice(slash + 1) ?? "")
  ) return false;
  return parameters.every((parameter) => {
    const trimmed = parameter.trim();
    const equals = trimmed.indexOf("=");
    if (equals < 1 || !MIME_TOKEN.test(trimmed.slice(0, equals))) return false;
    const raw = trimmed.slice(equals + 1);
    if (MIME_TOKEN.test(raw)) return true;
    if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return false;
    return Array.from(raw.slice(1, -1)).every((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 32 && code <= 126 && character !== '"' && character !== "\\";
    });
  });
}

function headers(input: IncomingHttpHeaders, rawHeaders: readonly string[], status: number): Headers {
  const counts = new Map<string, number>();
  for (let index = 0; index < rawHeaders.length; index += 2) {
    const name = rawHeaders[index]?.toLowerCase();
    if (name !== undefined && DELIVERY_RESPONSE_HEADERS.has(name)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  if ([...counts.values()].some((count) => count !== 1)) protocol();
  const contentType = input["content-type"];
  if (status !== 416 && (typeof contentType !== "string" || !validMimeType(contentType))) protocol();
  if (contentType !== undefined && (typeof contentType !== "string" || !validMimeType(contentType))) protocol();
  const output = new Headers();
  for (const [name, raw] of Object.entries(input)) {
    if (raw === undefined) continue;
    if (DELIVERY_RESPONSE_HEADERS.has(name.toLowerCase()) && Array.isArray(raw)) protocol();
    try {
      if (Array.isArray(raw)) for (const value of raw) output.append(name, value);
      else output.set(name, raw);
    } catch {
      protocol();
    }
  }
  return output;
}

/** Typed, non-buffering delivery transport. The supplied opener is already bound to the Platform mTLS origin. */
export function createNodeArtifactDeliveryTransport(input: Readonly<{
  binding: Readonly<{ workloadCredential: string }>;
  maximumTimeoutMs: number;
  open(request: NodeArtifactDeliveryOpenRequest): Promise<IncomingMessage>;
  now?: () => number;
}>): ArtifactDeliveryTransport {
  return Object.freeze({
    async redeem(request: ArtifactDeliveryTransportRequest) {
      const startedAt = (input.now ?? Date.now)();
      const timeoutMs = validate(request, input.maximumTimeoutMs);
      const response = await input.open({
        method: "GET",
        path: request.path,
        headers: Object.freeze({
          ...request.headers,
          accept: "application/octet-stream",
          "x-kokoro-workload-credential": input.binding.workloadCredential,
          "x-kokoro-artifact-delivery-capability": request.security.deliveryCapability,
        }),
        body: null,
        signal: request.signal,
        timeoutMs,
      });
      let responseHeaders: Headers;
      try {
        responseHeaders = headers(response.headers, response.rawHeaders, response.statusCode ?? 502);
      } catch (error) {
        const protocolError = error instanceof NodeArtifactDeliveryTransportError
          ? error
          : new NodeArtifactDeliveryTransportError("UPSTREAM_PROTOCOL_INVALID");
        response.once("error", () => undefined);
        response.destroy(protocolError);
        throw protocolError;
      }
      const elapsed = Math.max(0, (input.now ?? Date.now)() - startedAt);
      const remaining = Math.max(1, timeoutMs - elapsed);
      const onAbort = () => response.destroy(request.signal.reason);
      request.signal.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => {
        response.destroy(new NodeArtifactDeliveryTransportError("UPSTREAM_TIMEOUT"));
      }, remaining);
      timer.unref();
      const cleanup = () => {
        clearTimeout(timer);
        request.signal.removeEventListener("abort", onAbort);
      };
      response.once("close", cleanup);
      response.once("end", cleanup);
      response.once("error", cleanup);
      if (request.signal.aborted) onAbort();
      return Object.freeze({
        status: response.statusCode ?? 502,
        headers: responseHeaders,
        body: Readable.toWeb(response) as ReadableStream<Uint8Array>,
      });
    },
  });
}
