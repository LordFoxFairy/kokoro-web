import {
  matchSessionBrowserV3Request,
  SessionProxyError,
} from "@kokoro/bff-runtime"
import { errorEnvelopeSchema, type ErrorDetail } from "@kokoro/session-client/contracts"
import { randomUUID } from "node:crypto"

import { readOpaqueAuthSessionFromRequest } from "@/auth"
import { readBoundedRequestJson, SESSION_REQUEST_BODY_MAX_BYTES } from "@/lib/server/http-boundary"
import {
  assembleSessionBrowserV3,
  sessionV3PublicOrigin,
  SessionV3AssemblyError,
} from "@/lib/server/session-v3"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MUTATIONS = new Set(["POST", "PUT", "PATCH", "DELETE"])

function problem(
  status: number,
  code: ErrorDetail["code"],
  message: string,
  retryClass: ErrorDetail["retry_class"],
  action: ErrorDetail["action"],
): Response {
  const requestId = randomUUID()
  const envelope = errorEnvelopeSchema.parse({
    error: { code, message, retry_class: retryClass, action },
    request_id: requestId,
    correlation_id: requestId,
  })
  return new Response(JSON.stringify(envelope), {
    status,
    headers: { "cache-control": "no-store", "content-type": "application/problem+json" },
  })
}

function verifiedBrowserHeaders(request: Request, configuredOrigin: string): Headers {
  const headers = new Headers()
  const fetchSite = request.headers.get("sec-fetch-site")
  const browserOrigin = request.headers.get("origin")
  if (
    fetchSite !== "same-origin" ||
    (browserOrigin !== null && browserOrigin !== configuredOrigin) ||
    (MUTATIONS.has(request.method) && browserOrigin !== configuredOrigin)
  ) throw new SessionProxyError("BROWSER_REQUEST_UNVERIFIED")
  // The adapter supplies the registered origin for GET because browsers commonly omit Origin there.
  headers.set("origin", configuredOrigin)
  headers.set("sec-fetch-site", fetchSite)
  for (const name of ["accept", "content-type", "last-event-id", "x-csrf-token"] as const) {
    const value = request.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  return headers
}

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  try {
    const { path } = await context.params
    const url = new URL(request.url)
    const matched = matchSessionBrowserV3Request({
      method: request.method,
      pathname: `/${(path ?? []).join("/")}`,
      searchParams: url.searchParams,
    })
    const authSession = await readOpaqueAuthSessionFromRequest(request)
    if (authSession === null) {
      return problem(
        401,
        "SESSION_ACCESS_GRANT_REQUIRED",
        "Sign in again to establish a Platform session",
        "after_user_action",
        "reauthenticate",
      )
    }
    const configuredOrigin = sessionV3PublicOrigin()
    const browserHeaders = verifiedBrowserHeaders(request, configuredOrigin)
    let body: unknown
    if (request.method === "GET") {
      body = undefined
    } else {
      const parsed = await readBoundedRequestJson(request, SESSION_REQUEST_BODY_MAX_BYTES)
      if (!parsed.ok) {
        return parsed.reason === "too_large"
          ? problem(413, "PAYLOAD_TOO_LARGE", "Session request body is too large", "never", "stop")
          : problem(400, "REQUEST_INVALID", "Invalid Session request body", "never", "developer_error")
      }
      body = parsed.value
    }
    const runtime = await assembleSessionBrowserV3({ authSession })
    return await runtime.proxy.execute({
      operationId: matched.operationId,
      projectRef: runtime.bootstrap.defaultProjectRef,
      browser: {
        method: request.method,
        headers: browserHeaders,
        pathParameters: matched.pathParameters,
        query: matched.query,
        body,
        signal: request.signal,
      },
    })
  } catch (error) {
    if (error instanceof SessionV3AssemblyError) {
      return problem(503, "INTERNAL_UNAVAILABLE", "Session browser v3 is temporarily unavailable", "after_delay", "stop")
    }
    if (error instanceof SessionProxyError) {
      const forbidden = error.code.startsWith("BROWSER_")
      return problem(forbidden ? 403 : 400, "REQUEST_INVALID", "Session request was rejected", "never", "developer_error")
    }
    return problem(503, "INTERNAL_UNAVAILABLE", "Session browser v3 is temporarily unavailable", "after_delay", "stop")
  }
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
