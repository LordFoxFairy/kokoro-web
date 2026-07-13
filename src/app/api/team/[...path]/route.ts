// 团队自助面同源代理（BFF）：读信封 → 注入 web-bff caller 凭据 + user principal（x-user-id）→
// 转发到 kokoro-user 的 /bff/*（成员/邀请读写）。user principal 从密封信封派生，浏览器无从伪造。
// 绝不代理 /bff/auth/*（换签走专用 /api/team/switch，token 不回浏览器）；变更类请求校验同源 Origin。

import { NextResponse } from "next/server"

import {
  authConfig,
  INTERNAL_SECRET_HEADER,
  readEnvelope,
  sameOriginOk,
  SERVICE_HEADER,
  SERVICE_VALUE,
} from "@/lib/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])
// 仅放行成员/邀请读写前缀；auth（换签）等一律拒（防 runtime token 经通用代理泄回浏览器）。
const ALLOWED_PREFIXES = new Set(["me", "teams", "invites"])

async function proxy(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (MUTATION_METHODS.has(request.method) && !sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const envelope = readEnvelope(request, config)
  if (envelope === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }

  const { path } = await context.params
  const segments = path ?? []
  if (segments.length === 0 || !ALLOWED_PREFIXES.has(segments[0]!)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }

  const search = new URL(request.url).search
  const target = `${config.userBaseUrl.replace(/\/+$/, "")}/bff/${segments.join("/")}${search}`

  const headers = new Headers()
  headers.set(SERVICE_HEADER, SERVICE_VALUE)
  if (config.internalSecret !== null) {
    headers.set(INTERNAL_SECRET_HEADER, config.internalSecret)
  }
  // user principal 从信封派生（web 侧解封结果），浏览器无从伪造。
  headers.set("x-user-id", envelope.user_id)

  // 仅在确有 body 时透传 content-type：无 body 的 POST（accept/decline/remove-self）不能带
  // application/json，否则上游 fastify 对空体报 FST_ERR_CTP_EMPTY_JSON_BODY(400)。
  const rawBody =
    request.method === "GET" || request.method === "HEAD" ? "" : await request.text()
  const body = rawBody.length > 0 ? rawBody : undefined
  if (body !== undefined) {
    headers.set("content-type", request.headers.get("content-type") ?? "application/json")
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      ...(body !== undefined ? { body } : {}),
      cache: "no-store",
      signal: request.signal,
    })
  } catch {
    return NextResponse.json({ error: "user_unreachable" }, { status: 502 })
  }

  const responseHeaders = new Headers()
  const contentType = upstream.headers.get("content-type")
  if (contentType !== null) {
    responseHeaders.set("content-type", contentType)
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

export const GET = proxy
export const POST = proxy
export const DELETE = proxy
