// 会话态探针（BFF）：登录闸据此决定放行/挡门。先绑定 Host 权威 Site，再对快过期 access
// 执行零 body refresh 并写回 httpOnly cookie；流式 upload 遇到 428 也通过本端点刷新后重试。
// preview=未接 platform（放行走纯前端预览）；authenticated=有效信封（放行）；anonymous=挡门登录。

import { NextResponse } from "next/server"

import { authConfig, preflightSession, resolveSessionWithRefresh } from "@/lib/server/auth"
import { resolveSiteId } from "@/lib/server/site"

export const runtime = "nodejs"

export async function GET(request: Request): Promise<NextResponse> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ state: "preview" })
  }
  const siteId = await resolveSiteId(request.headers.get("host"), config.siteId)
  if (siteId === null) {
    return NextResponse.json({ state: "anonymous" })
  }
  const preflight = preflightSession(request, config, siteId)
  if (preflight === null) {
    return NextResponse.json({ state: "anonymous" })
  }
  const resolved = await resolveSessionWithRefresh(request, config, siteId, preflight)
  if (resolved === null) {
    return NextResponse.json({ state: "anonymous" })
  }
  const response = NextResponse.json({ state: "authenticated" })
  if (resolved.setCookie !== null) {
    response.headers.append("set-cookie", resolved.setCookie)
  }
  return response
}
