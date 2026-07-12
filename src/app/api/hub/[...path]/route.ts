// hub 同源代理骨架（BFF）：结构就位（信封取 namespace + 内部凭据出站），但本项（AUTH-P0）
// 只落关闭态——一律 403 hub_disabled。真正放开转发在 HUB-AUTHZ / WEB-SKILLS 落地。

import { NextResponse } from "next/server"

import { authConfig, readEnvelope } from "@/lib/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handler(request: Request): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (readEnvelope(request, config) === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  // 关闭态：能力 hub 授权与转发尚未开放。
  return NextResponse.json({ error: "hub_disabled" }, { status: 403 })
}

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
