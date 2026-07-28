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
  preflightSession,
  resolveSessionWithRefresh,
  sameOriginOk,
  SERVICE_HEADER,
  SERVICE_VALUE,
} from "@/lib/server/auth"
import {
  acquireHubUploadLease,
  HUB_UPLOAD_REQUEST_BODY_MAX_BYTES,
  hubRequestBodyLimit,
  isHubUploadPath,
  prepareCountedRequestBody,
  readBoundedRequestBody,
  type CountedBodyCompletion,
} from "@/lib/server/http-boundary"
import { resolveSiteId } from "@/lib/server/site"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

// 仅透传 hub 实际需要的入站头（含 multipart 的 content-type+boundary）；绝不转发 cookie，
// 也绝不转发浏览器可能伪造的 x-kokoro-* 身份头（新建 Headers 天然丢弃它们）。
const FORWARD_HEADERS = ["accept", "content-type"] as const

// self 面的密封身份头（scope 恒取信封 namespace；userId 取信封 user_id）。
const NAMESPACE_HEADER = "x-kokoro-namespace"
const USER_ID_HEADER = "x-kokoro-user-id"

function bodyError(reason: "too_large" | "invalid" | "aborted"): Response {
  return NextResponse.json(
    { error: reason === "too_large" ? "request_body_too_large" : "invalid_request_body" },
    { status: reason === "too_large" ? 413 : 400 },
  )
}

function upstreamResponse(upstream: Response, setCookie: string | null): Response {
  const responseHeaders = new Headers()
  for (const name of ["content-type", "cache-control", "content-length"]) {
    const value = upstream.headers.get(name)
    if (value !== null) responseHeaders.set(name, value)
  }
  if (setCookie !== null) responseHeaders.append("set-cookie", setCookie)
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}

async function proxyUpload(
  request: Request,
  config: NonNullable<ReturnType<typeof authConfig>>,
  siteId: string,
  preflight: NonNullable<ReturnType<typeof preflightSession>>,
  target: string,
  headers: Headers,
): Promise<Response> {
  const prepared = await prepareCountedRequestBody(request, HUB_UPLOAD_REQUEST_BODY_MAX_BYTES)
  if (!prepared.ok) return bodyError(prepared.reason)

  const admission = acquireHubUploadLease(request.headers)
  if (!admission.ok) {
    prepared.abort(new Error(admission.error))
    return NextResponse.json(
      { error: admission.error },
      { status: admission.status, headers: { "retry-after": String(admission.retryAfter) } },
    )
  }

  const signal = AbortSignal.any([request.signal, prepared.signal])
  const init = {
    method: request.method,
    headers,
    ...(prepared.body !== undefined ? { body: prepared.body, duplex: "half" as const } : {}),
    cache: "no-store" as const,
    signal,
  }
  const upstreamPromise = fetch(target, init).then(
    (response) => ({ ok: true, response }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  )

  try {
    const first = await Promise.race([
      prepared.completion.then((completion) => ({ kind: "body", completion }) as const),
      upstreamPromise.then((outcome) => ({ kind: "upstream", outcome }) as const),
    ])

    let completion: CountedBodyCompletion
    if (first.kind === "upstream" && !first.outcome.ok) {
      if (request.signal.aborted || prepared.signal.aborted) {
        completion = await prepared.completion
        return bodyError(completion.ok ? "aborted" : completion.reason)
      }
      prepared.abort(first.outcome.error)
      await prepared.completion
      return NextResponse.json({ error: "hub_unreachable" }, { status: 502 })
    }
    completion = first.kind === "body" ? first.completion : await prepared.completion
    if (!completion.ok) {
      prepared.abort(new Error(completion.reason))
      await upstreamPromise
      return bodyError(completion.reason)
    }

    // Hub upload invariant：下游完整读取 multipart 后才进入持久化；因此只有 counted body EOF 后才允许
    // refresh rotation。本轮不增加 staging receipt，长期跨进程恢复列入 W3。
    const resolved = await resolveSessionWithRefresh(request, config, siteId, preflight)
    if (resolved === null) {
      prepared.abort(new Error("unauthenticated"))
      await upstreamPromise
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
    }
    const outcome = await upstreamPromise
    if (!outcome.ok) return NextResponse.json({ error: "hub_unreachable" }, { status: 502 })
    return upstreamResponse(outcome.response, resolved.setCookie)
  } finally {
    admission.lease.release()
  }
}

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
  const siteId = await resolveSiteId(request.headers.get("host"), config.siteId)
  if (siteId === null) {
    return NextResponse.json({ error: "site_unresolved" }, { status: 404 })
  }
  const preflight = preflightSession(request, config, siteId)
  if (preflight === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }

  const { path } = await context.params
  const segments = path ?? []
  const search = new URL(request.url).search
  const target = `${config.hubBaseUrl.replace(/\/+$/, "")}/hub/${segments.join("/")}${search}`

  const headers = new Headers()
  headers.set(SERVICE_HEADER, SERVICE_VALUE)
  if (config.internalSecret !== null) {
    headers.set(INTERNAL_SECRET_HEADER, config.internalSecret)
  }
  // upload 在 body EOF 前不得 refresh，故身份先取已完成 Site 绑定的只读 preflight；普通请求会在
  // body acceptance 后用 refreshed envelope 覆盖这两个值。
  headers.set(NAMESPACE_HEADER, preflight.namespace)
  headers.set(USER_ID_HEADER, preflight.user_id)
  for (const name of FORWARD_HEADERS) {
    const value = request.headers.get(name)
    if (value !== null) {
      headers.set(name, value)
    }
  }

  if (isHubUploadPath(segments)) {
    if (request.method !== "POST") {
      await request.body?.cancel().catch(() => undefined)
      return NextResponse.json({ error: "method_not_allowed" }, { status: 405 })
    }
    return proxyUpload(request, config, siteId, preflight, target, headers)
  }

  const boundedBody = await readBoundedRequestBody(request, hubRequestBodyLimit(segments))
  if (!boundedBody.ok) {
    return bodyError(boundedBody.reason)
  }
  const body =
    request.method === "GET" || request.method === "HEAD" || request.method === "DELETE"
      ? undefined
      : boundedBody.body

  const resolved = await resolveSessionWithRefresh(request, config, siteId, preflight)
  if (resolved === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  const { envelope, setCookie } = resolved
  headers.set(NAMESPACE_HEADER, envelope.namespace)
  headers.set(USER_ID_HEADER, envelope.user_id)

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

  return upstreamResponse(upstream, setCookie)
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
