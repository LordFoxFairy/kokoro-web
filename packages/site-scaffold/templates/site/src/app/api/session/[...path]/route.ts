import { randomUUID } from "node:crypto";

import { matchSessionBrowserV3Request, SessionProxyError } from "@kokoro/bff-runtime";
import { errorEnvelopeSchema, type ErrorDetail } from "@kokoro/session-client/contracts";

import { readOpaqueAuthSession } from "../../../../auth";
import { siteBff } from "../../../../bff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAXIMUM_BODY_BYTES = 2_097_152;
const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function problem(status: number, code: ErrorDetail["code"], message: string): Response {
  const requestId = randomUUID();
  return Response.json(errorEnvelopeSchema.parse({
    error: { code, message, retry_class: status >= 500 ? "after_delay" : "never", action: status === 401 ? "reauthenticate" : "stop" },
    request_id: requestId,
    correlation_id: requestId,
  }), { status, headers: { "cache-control": "no-store" } });
}

async function boundedJson(request: Request): Promise<unknown> {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAXIMUM_BODY_BYTES)) {
    throw new RangeError("body too large");
  }
  if (request.body === null) throw new SyntaxError("missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAXIMUM_BODY_BYTES) throw new RangeError("body too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  try {
    const opaque = await readOpaqueAuthSession();
    if (opaque === null) return problem(401, "SESSION_ACCESS_GRANT_REQUIRED", "Sign in again");
    const { path } = await context.params;
    const url = new URL(request.url);
    const matched = matchSessionBrowserV3Request({
      method: request.method,
      pathname: `/${path.join("/")}`,
      searchParams: url.searchParams,
    });
    const bff = siteBff();
    const fetchSite = request.headers.get("sec-fetch-site");
    const origin = request.headers.get("origin");
    if (fetchSite !== "same-origin" || (MUTATIONS.has(request.method) && origin !== bff.publicOrigin)) {
      return problem(403, "REQUEST_INVALID", "Browser request was rejected");
    }
    const headers = new Headers({ origin: bff.publicOrigin, "sec-fetch-site": fetchSite });
    for (const name of ["accept", "content-type", "last-event-id", "x-csrf-token"]) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const session = await bff.assemble(opaque);
    return session.proxy.execute({
      operationId: matched.operationId,
      projectRef: session.bootstrap.defaultProjectRef,
      browser: {
        method: request.method,
        headers,
        pathParameters: matched.pathParameters,
        query: matched.query,
        body: request.method === "GET" ? undefined : await boundedJson(request),
        signal: request.signal,
      },
    });
  } catch (error) {
    if (error instanceof RangeError) return problem(413, "PAYLOAD_TOO_LARGE", "Request body is too large");
    if (error instanceof SyntaxError || error instanceof SessionProxyError) return problem(400, "REQUEST_INVALID", "Request was rejected");
    return problem(503, "INTERNAL_UNAVAILABLE", "Session is temporarily unavailable");
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
