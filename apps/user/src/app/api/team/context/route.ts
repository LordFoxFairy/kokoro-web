// 团队上下文探针（BFF）：回当前信封的 namespace（=当前所在团队 id），供切换器高亮当前项。
// namespace 非机密（me/teams 本就回该用户全部 team id）；无信封 → namespace:null。

import { NextResponse } from "next/server"

import { authConfig, readEnvelope } from "@/lib/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request): Promise<NextResponse> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ namespace: null })
  }
  const envelope = readEnvelope(request, config)
  return NextResponse.json({ namespace: envelope?.namespace ?? null })
}
