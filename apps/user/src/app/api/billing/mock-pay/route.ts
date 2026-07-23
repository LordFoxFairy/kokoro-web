// DEV 模拟支付 BFF：把 dev 模拟收银台的「确认支付」翻译成一条**签名的 mock 支付成功 webhook**，
// 打到 kokoro-payment 公开 webhook（/payments/webhooks/mock）→ 验签 + 幂等 + confirmOrder → 到账。
// 仅 dev：mockWebhookSecret 未配（生产）→ 503。真网关档由 provider 自己回调 webhook，无需此 BFF。
// 要求登录（无信封→401）+ 同源（变更类）。签名走 x-kokoro-webhook-signature（HMAC-SHA256 over raw body）。

import { createHmac, randomUUID } from "node:crypto"

import { NextResponse } from "next/server"
import { z } from "zod"

import { authConfig, readEnvelope, sameOriginOk } from "@/lib/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MOCK_SIGNATURE_HEADER = "x-kokoro-webhook-signature"
// 浏览器只提交 order_id；身份/金额一律后端与订单派生，浏览器无从伪造。
const mockPayRequestSchema = z.object({ order_id: z.string().min(1) }).strip()

export async function POST(request: Request): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  if (readEnvelope(request, config) === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  // dev-only：无 mock 密钥（生产）或未配 payment → 诚实不可用（模拟支付只在 dev 存在）。
  if (config.paymentBaseUrl === null || config.mockWebhookSecret === null) {
    return NextResponse.json({ error: "mock_pay_unavailable" }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  const parsed = mockPayRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  // mock 支付成功事件：eventId 唯一（每次点击一条；confirmOrder 幂等保证不双发到账）。
  const eventBody = JSON.stringify({
    eventId: `mock-${randomUUID()}`,
    eventType: "payment_succeeded",
    data: { orderId: parsed.data.order_id },
  })
  const signature = createHmac("sha256", config.mockWebhookSecret).update(eventBody).digest("hex")

  const target = `${config.paymentBaseUrl.replace(/\/+$/, "")}/payments/webhooks/mock`
  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json", [MOCK_SIGNATURE_HEADER]: signature },
      body: eventBody,
      cache: "no-store",
      signal: request.signal,
    })
  } catch {
    return NextResponse.json({ error: "payment_unreachable" }, { status: 502 })
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: "mock_pay_failed" }, { status: 502 })
  }
  return NextResponse.json({ ok: true }, { status: 200 })
}
