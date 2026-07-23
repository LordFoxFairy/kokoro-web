// DEV 调试面板门控探针（BFF）：只回「dev 工具是否可用」+ web 侧能力事实（皆非机密）。
// 门控与 mock-pay 同源——mockWebhookSecret 仅 dev 配置、生产结构性缺失，故 enabled 在生产恒 false，
// dev 面板在生产永不渲染（不靠 hostname 猜，靠 prod 缺失的配置信号）。无机密外泄：只回布尔能力位。

import { NextResponse } from "next/server"

import { authConfig } from "@/lib/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export function GET(): NextResponse {
  const config = authConfig()
  // dev 信号：mock webhook 密钥仅 dev 配置（生产必缺）——与 mock-pay 判据一致。
  const enabled = config !== null && config.mockWebhookSecret !== null
  if (!enabled) {
    return NextResponse.json({ enabled: false })
  }
  return NextResponse.json({
    enabled: true,
    // 能力位（非机密）：面板据此决定给不给「模拟充值」快捷入口。
    mockPayAvailable: config.paymentBaseUrl !== null && config.mockWebhookSecret !== null,
    paymentConfigured: config.paymentBaseUrl !== null,
  })
}
