// 会话态探针（BFF）：登录闸据此决定放行/挡门。浏览器读不到 httpOnly 信封，故由服务端裁决。
// preview=未接 platform（放行走纯前端预览）；authenticated=有效信封（放行）；anonymous=挡门登录。

import { NextResponse } from "next/server"

import { authConfig, readEnvelope } from "@/lib/server/auth"

export const runtime = "nodejs"

export async function GET(request: Request): Promise<NextResponse> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ state: "preview" })
  }
  const envelope = readEnvelope(request, config)
  return NextResponse.json({ state: envelope === null ? "anonymous" : "authenticated" })
}
