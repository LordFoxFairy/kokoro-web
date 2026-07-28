// 公共分享同源代理（SHARE-1，无 auth 公共面）：转发到 kokoro-session 的 GET /shared/{id}，
// 绝不注入鉴权头、绝不读信封——公共只读快照面。仅 GET，仅 /shared 单段，绝不放宽其它路径。
// share_id 不可枚举随机；撤销/软删会话由 session 侧回 404。

import { NextResponse } from "next/server"

import { authConfig } from "@/lib/server/auth"
import { isUpstreamTimeoutError, withUpstreamDeadline } from "@/lib/server/upstream"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  const { id } = await context.params
  // 单段守门：share_id 不含 '/'（路由已按 [id] 单段捕获），拒绝空段。
  if (id.length === 0) {
    return NextResponse.json({ error: "share_not_found" }, { status: 404 })
  }
  const target = `${config.sessionBaseUrl.replace(/\/+$/, "")}/shared/${encodeURIComponent(id)}`

  let upstream: Response
  try {
    upstream = await withUpstreamDeadline(request.signal, config.upstreamTimeoutMs, (signal) =>
      fetch(target, { cache: "no-store", signal }),
    )
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      return NextResponse.json({ error: "upstream_timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: "session_unreachable" }, { status: 502 })
  }

  const responseHeaders = new Headers()
  const contentType = upstream.headers.get("content-type")
  if (contentType !== null) {
    responseHeaders.set("content-type", contentType)
  }
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
}
