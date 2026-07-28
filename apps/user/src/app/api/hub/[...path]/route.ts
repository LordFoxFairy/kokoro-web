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
  hasSufficientAccessWindow,
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
import {
  createUpstreamDeadline,
  isUpstreamTimeoutError,
  withUpstreamDeadline,
} from "@/lib/server/upstream"

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

function sessionRefreshRequired(): Response {
  return NextResponse.json(
    {
      error: {
        code: "session_refresh_required",
        message: "Refresh the browser session before retrying this upload",
      },
    },
    { status: 428, headers: { "retry-after": "1" } },
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
  target: string,
  headers: Headers,
  upstreamTimeoutMs: number,
): Promise<Response> {
  const prepared = await prepareCountedRequestBody(request, HUB_UPLOAD_REQUEST_BODY_MAX_BYTES)
  if (!prepared.ok) return bodyError(prepared.reason)

  const admission = acquireHubUploadLease(request.headers)
  if (!admission.ok) {
    await prepared.dispose(new Error(admission.error))
    return NextResponse.json(
      { error: admission.error },
      { status: admission.status, headers: { "retry-after": String(admission.retryAfter) } },
    )
  }

  const deadline = createUpstreamDeadline(request.signal, upstreamTimeoutMs, { startImmediately: false })
  try {
    const signal = AbortSignal.any([deadline.signal, prepared.signal])
    const init = {
      method: request.method,
      headers,
      ...(prepared.body !== undefined ? { body: prepared.body, duplex: "half" as const } : {}),
      cache: "no-store" as const,
      signal,
    }
    const upstreamPromise = Promise.resolve()
      .then(() => fetch(target, init))
      .then(
        (response) => ({ ok: true, response }) as const,
        (error: unknown) => ({ ok: false, error }) as const,
      )
    const first = await Promise.race([
      prepared.completion.then((completion) => ({ kind: "body", completion }) as const),
      upstreamPromise.then((outcome) => ({ kind: "upstream", outcome }) as const),
    ])

    if (first.kind === "upstream") {
      const outcome = first.outcome
      if (!outcome.ok) {
        await prepared.dispose(outcome.error)
        if (request.signal.aborted) return bodyError("aborted")
        return NextResponse.json({ error: "hub_unreachable" }, { status: 502 })
      }
      await prepared.dispose(new Error(`hub responded before upload EOF (${outcome.response.status})`))
      if (outcome.response.ok) {
        return NextResponse.json({ error: "hub_upload_protocol_error" }, { status: 502 })
      }
      return new Response(null, { status: outcome.response.status })
    }
    const completion: CountedBodyCompletion = first.completion
    if (!completion.ok) {
      await prepared.dispose(new Error(completion.reason))
      return bodyError(completion.reason)
    }

    // 96MiB ingress 可以合法地超过普通 JSON deadline；只在完整 body EOF 后限制 Hub 处理到 headers。
    deadline.start()
    const outcome = await upstreamPromise
    if (!outcome.ok) {
      if (deadline.didTimeout()) {
        await prepared.dispose(outcome.error)
        return NextResponse.json({ error: "upstream_timeout" }, { status: 504 })
      }
      return NextResponse.json({ error: "hub_unreachable" }, { status: 502 })
    }
    return upstreamResponse(outcome.response, null)
  } finally {
    deadline.finish()
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
  let siteId: string | null
  try {
    siteId = await resolveSiteId(request.headers.get("host"), config.siteId, request.signal)
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      return NextResponse.json({ error: "upstream_timeout" }, { status: 504 })
    }
    throw error
  }
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
    if (!hasSufficientAccessWindow(preflight.access_exp, Math.floor(Date.now() / 1000))) {
      await request.body?.cancel().catch(() => undefined)
      return sessionRefreshRequired()
    }
    return proxyUpload(request, target, headers, config.upstreamTimeoutMs)
  }

  const boundedBody = await readBoundedRequestBody(request, hubRequestBodyLimit(segments))
  if (!boundedBody.ok) {
    return bodyError(boundedBody.reason)
  }
  const body =
    request.method === "GET" || request.method === "HEAD" || request.method === "DELETE"
      ? undefined
      : boundedBody.body

  let resolved: Awaited<ReturnType<typeof resolveSessionWithRefresh>>
  try {
    resolved = await resolveSessionWithRefresh(request, config, siteId, preflight)
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      return NextResponse.json({ error: "upstream_timeout" }, { status: 504 })
    }
    throw error
  }
  if (resolved === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  const { envelope, setCookie } = resolved
  headers.set(NAMESPACE_HEADER, envelope.namespace)
  headers.set(USER_ID_HEADER, envelope.user_id)

  let upstream: Response
  try {
    upstream = await withUpstreamDeadline(request.signal, config.upstreamTimeoutMs, (signal) =>
      fetch(target, {
        method: request.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        cache: "no-store",
        signal,
      }),
    )
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      return NextResponse.json({ error: "upstream_timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: "hub_unreachable" }, { status: 502 })
  }

  return upstreamResponse(upstream, setCookie)
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
