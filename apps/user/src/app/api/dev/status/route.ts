// DEV 调试面板门控探针：只回「dev 工具是否可用」。生产环境恒 false；不读取业务/provider 密钥。

import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(): NextResponse {
  return NextResponse.json({ enabled: process.env.NODE_ENV !== "production" })
}
