// 团队切换（BFF）：读信封取 user principal → 调 user 换签目标 team → 用新 runtime_jwt+namespace
// 重新密封信封 cookie。浏览器只收 { ok, namespace }，token 全程留服务端。切换后前端整页刷新，
// Wave3 三竖切（rail/技能/余额）随新 namespace 天然重水合。403=非该 team 活跃成员。

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  authConfig,
  decodeJwtExp,
  sameOriginOk,
  SESSION_COOKIE,
  sessionCookieOptions,
  readEnvelope,
  userIssueTeamSession,
} from "@/lib/server/auth"
import { readBoundedRequestJson, TEAM_REQUEST_BODY_MAX_BYTES } from "@/lib/server/http-boundary"
import { sealEnvelope } from "@/lib/server/session-envelope"
import { resolveSiteId } from "@/lib/server/site"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const bodySchema = z.object({ team_id: z.string().trim().min(1) }).strict()

export async function POST(request: Request): Promise<NextResponse> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const envelope = readEnvelope(request, config)
  if (envelope === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  const requestBody = await readBoundedRequestJson(request, TEAM_REQUEST_BODY_MAX_BYTES)
  if (!requestBody.ok && requestBody.reason === "too_large") {
    return NextResponse.json({ error: "request_body_too_large" }, { status: 413 })
  }
  const parsed = bodySchema.safeParse(requestBody.ok ? requestBody.value : null)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 })
  }

  // 换签前重新绑定当前 Host。Site 不可解析时不触达 user issuer，也不覆盖现有可信信封。
  const siteId = await resolveSiteId(request.headers.get("host"), config.siteId)
  if (siteId === null || siteId !== envelope.site_id) {
    return NextResponse.json({ error: "site_unresolved" }, { status: 404 })
  }

  const outcome = await userIssueTeamSession(config, envelope.user_id, parsed.data.team_id, siteId)
  if (outcome.kind === "forbidden") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 })
  }
  if (outcome.kind === "unavailable") {
    return NextResponse.json({ error: "unavailable" }, { status: 502 })
  }
  if (outcome.result.site_id !== siteId || outcome.result.site_id !== envelope.site_id) {
    return NextResponse.json({ error: "unavailable" }, { status: 502 })
  }

  const nowSec = Math.floor(Date.now() / 1000)
  const accessExp = decodeJwtExp(outcome.result.token) ?? nowSec + 3600
  // 信封/cookie 寿命 = 换团队新签的 refresh 寿命（30 天）。
  const refreshExpMs = new Date(outcome.result.refresh_expires_at).getTime()
  const refreshExp = Number.isFinite(refreshExpMs) ? Math.floor(refreshExpMs / 1000) : nowSec + 2_592_000
  const maxAge = Math.max(0, refreshExp - nowSec)
  const sealed = sealEnvelope(
    {
      runtime_jwt: outcome.result.token,
      access_exp: accessExp,
      refresh_token: outcome.result.refresh_token,
      user_id: outcome.result.user.id,
      namespace: outcome.result.namespace,
      site_id: siteId,
      exp: refreshExp,
    },
    config.sessionSecrets,
  )

  const response = NextResponse.json({ ok: true, namespace: outcome.result.namespace })
  response.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions(config, maxAge))
  return response
}
