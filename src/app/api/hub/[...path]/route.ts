// hub 同源代理（BFF，WEB-SKILLS）：读信封 → 注入 web-bff caller 凭据 + scope/user 身份头 →
// 转发到 kokoro-hub 的 self 面。scope 恒取自密封信封的 namespace，绝不透传浏览器参数当 scope；
// 浏览器只见同源 `/api/hub/*`，runtime 凭据与 namespace 身份全留服务端。变更类请求校验同源 Origin。
//
// 路径约定：浏览器调 `/api/hub/self/skills/pool` → 代理前缀 `/hub` → `${hubBaseUrl}/hub/self/skills/pool`
// （hub 服务把 self 面挂在 `/hub/self`）。上传走 multipart：透传浏览器 content-type（含 boundary），
// 不强制 application/json。

import { NextResponse } from "next/server"

import {
  authConfig,
  INTERNAL_SECRET_HEADER,
  resolveSessionWithRefresh,
  sameOriginOk,
  SERVICE_HEADER,
  SERVICE_VALUE,
} from "@/lib/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// 仅透传 hub 实际需要的入站头（含 multipart 的 content-type+boundary）；绝不转发 cookie，
// 也绝不转发浏览器可能伪造的 x-kokoro-* 身份头（新建 Headers 天然丢弃它们）。
const FORWARD_HEADERS = ["accept", "content-type"] as const

// self 面的密封身份头（scope 恒取信封 namespace；userId 取信封 user_id）。
const NAMESPACE_HEADER = "x-kokoro-namespace"
const USER_ID_HEADER = "x-kokoro-user-id"

async function proxy(request: Request, context: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (config.hubBaseUrl === null) {
    // 未接 hub 节点（预览档）：能力面不可用，展示层据此降级。
    return NextResponse.json({ error: "hub_not_configured" }, { status: 503 })
  }
  if (MUTATION_METHODS.has(request.method) && !sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const resolved = await resolveSessionWithRefresh(request, config)
  if (resolved === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  const { envelope, setCookie } = resolved

  const { path } = await context.params
  const search = new URL(request.url).search
  const target = `${config.hubBaseUrl.replace(/\/+$/, "")}/hub/${(path ?? []).join("/")}${search}`

  const headers = new Headers()
  headers.set(SERVICE_HEADER, SERVICE_VALUE)
  if (config.internalSecret !== null) {
    headers.set(INTERNAL_SECRET_HEADER, config.internalSecret)
  }
  // scope/user 身份轴从信封派生（web 侧解析后的密封结果），浏览器无从伪造。
  headers.set(NAMESPACE_HEADER, envelope.namespace)
  headers.set(USER_ID_HEADER, envelope.user_id)
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) {
      headers.set(name, value)
    }
  }

  const body =
    request.method === "GET" || request.method === "HEAD" || request.method === "DELETE"
      ? undefined
      : await request.arrayBuffer()

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
    return NextResponse.json({ error: "hub_unreachable" }, { status: 502 })
  }

  // 原样回传状态与内容类型，body 流式转发（错误码/审核态由展示层解析 hub 响应体决定）。
  const responseHeaders = new Headers()
  for (const name of ["content-type", "cache-control", "content-length"]) {
    const value = upstream.headers.get(name)
    if (value !== null) {
      responseHeaders.set(name, value)
    }
  }
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
