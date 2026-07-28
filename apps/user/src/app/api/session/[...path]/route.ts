// session 同源代理（BFF）：读信封 → 注入 Authorization: Bearer <runtime_jwt> → 透传到
// kokoro-session。HTTP/SSE/二进制一律流式转发（files/deliveries 大流不缓冲）。浏览器只见同源
// `/api/session/*`，runtime_jwt 全程留在服务端。变更类请求校验同源 Origin。

import { NextResponse } from "next/server"

import { authConfig, resolveSessionWithRefresh, sameOriginOk } from "@/lib/server/auth"
import { readBoundedRequestBody, SESSION_REQUEST_BODY_MAX_BYTES } from "@/lib/server/http-boundary"
import { resolveSiteId } from "@/lib/server/site"

export const runtime = "nodejs"
// 每请求实时求值：绝不静态化/缓存代理响应（SSE、鉴权头随信封变）。
export const dynamic = "force-dynamic"

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// 仅转发 session 实际需要的入站头，绝不转发 cookie（信封 cookie 不得外泄到 session）。
const FORWARD_HEADERS = ["accept", "content-type", "last-event-id"] as const

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (MUTATION_METHODS.has(request.method) && !sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const siteId = await resolveSiteId(request.headers.get("host"), config.siteId)
  if (siteId === null) {
    return NextResponse.json({ error: "site_unresolved" }, { status: 404 })
  }
  const resolved = await resolveSessionWithRefresh(request, config, siteId)
  if (resolved === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  const { envelope, setCookie } = resolved

  const { path } = await context.params
  const search = new URL(request.url).search
  const target = `${config.sessionBaseUrl.replace(/\/+$/, "")}/${(path ?? []).join("/")}${search}`

  const headers = new Headers()
  headers.set("authorization", `Bearer ${envelope.runtime_jwt}`)
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) {
      headers.set(name, value)
    }
  }

  const boundedBody = await readBoundedRequestBody(request, SESSION_REQUEST_BODY_MAX_BYTES)
  if (!boundedBody.ok) {
    return NextResponse.json(
      { error: boundedBody.reason === "too_large" ? "request_body_too_large" : "invalid_request_body" },
      { status: boundedBody.reason === "too_large" ? 413 : 400 },
    )
  }
  // GET/HEAD/DELETE 不向上游带 body；若客户端违规携带，仍已在上面读取并受硬顶约束。
  const body =
    request.method === "GET" || request.method === "HEAD" || request.method === "DELETE"
      ? undefined
      : boundedBody.body

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
      // 客户端断开（关流/切会话）级联中止上游。
      signal: request.signal,
    })
  } catch {
    return NextResponse.json({ error: "session_unreachable" }, { status: 502 })
  }

  // 原样回传状态与内容类型，body 直接流式（SSE/二进制不缓冲）。
  const responseHeaders = new Headers()
  for (const name of ["content-type", "cache-control", "content-disposition", "content-length"]) {
    const value = upstream.headers.get(name)
    if (value !== null) {
      responseHeaders.set(name, value)
    }
  }
  // 静默续期发生了 → 把重新密封的信封 cookie 写回浏览器（下次请求带新 access/refresh）。
  if (setCookie !== null) {
    responseHeaders.append("set-cookie", setCookie)
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
export const HEAD = proxy
