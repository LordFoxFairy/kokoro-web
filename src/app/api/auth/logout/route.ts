// 登出（BFF）：同 path 立即过期信封 cookie。同源守卫（变更类）。

import { NextResponse } from "next/server"

import { authConfig, SESSION_COOKIE, sameOriginOk } from "@/lib/server/auth"

export const runtime = "nodejs"

export async function POST(request: Request): Promise<NextResponse> {
  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const response = NextResponse.json({ status: "logged_out" })
  const config = authConfig()
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
