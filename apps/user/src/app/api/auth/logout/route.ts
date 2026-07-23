// 登出（BFF）：同 path 立即过期信封 cookie。同源守卫（变更类）。

import { NextResponse } from "next/server"

import { authConfig, readEnvelope, SESSION_COOKIE, sameOriginOk, userRevokeSession } from "@/lib/server/auth"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const config = authConfig()
  // 服务端吊销该会话 refresh（best-effort，不阻塞登出）：清 cookie 只断本浏览器，
  // 吊销才让被盗/其他持有的 refresh 立即失效，不等 exp 到期。
  if (config !== null) {
    const envelope = readEnvelope(request, config)
    if (envelope !== null) {
      await userRevokeSession(config, envelope.refresh_token)
    }
  }
  const response = NextResponse.json({ status: "logged_out" })
  // 未配置也回 200：无信封可清即已是登出态。secure 标志按配置（缺省非生产=false）。
  const secure = config?.secureCookies ?? false
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 0,
  })
  return response
}
