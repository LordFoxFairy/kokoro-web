// 收银台 BFF（PAY-2）：读信封 → 派生 site_id + teamId（=信封 namespace，team 运行时键，浏览器无从伪造）
// → 注入 web-bff caller 凭据 → 转发到 kokoro-payment 的 POST /orders/checkout。诚实态优先：
// provider 未配置时 payment 回 501（未开通），BFF 原样透传 501，浏览器据此禁用购买按钮（非假按钮）。
// 购买要求登录：无信封 → 401（未登录不可买）。变更类请求校验同源 Origin。

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  authConfig,
  INTERNAL_SECRET_HEADER,
  readEnvelope,
  sameOriginOk,
  SERVICE_HEADER,
  SERVICE_VALUE,
} from "@/lib/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SITE_ID_HEADER = "x-kokoro-site-id"

// 浏览器只提交 plan_id；site/owner 一律信封派生。显式 .strip()：即便请求夹带 teamId/siteId 等身份字段，
// 一律剥离无视（绝不接收浏览器传来的身份轴），杜绝伪造。
const checkoutRequestSchema = z.object({ plan_id: z.string().min(1) }).strip()

// payment checkout 成功（provider 已配置）：{data:{checkoutUrl}}。V1 无托管收银台，此路径暂不可达。
const paymentCheckoutOkSchema = z.object({ data: z.object({ checkoutUrl: z.string().min(1) }) })

export async function POST(request: Request): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const envelope = readEnvelope(request, config)
  if (envelope === null) {
    // 购买要求登录：未登录不可买（诚实态，不放行匿名下单）。
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  if (config.paymentBaseUrl === null) {
    return NextResponse.json({ error: "payment_not_configured" }, { status: 503 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  const parsed = checkoutRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }

  const headers = new Headers()
  headers.set("content-type", "application/json")
  headers.set(SERVICE_HEADER, SERVICE_VALUE)
  if (config.internalSecret !== null) {
    headers.set(INTERNAL_SECRET_HEADER, config.internalSecret)
  }
  headers.set(SITE_ID_HEADER, envelope.site_id)

  const target = `${config.paymentBaseUrl.replace(/\/+$/, "")}/orders/checkout`
  // teamId 从信封 namespace 派生（team 运行时隔离键）；site 由 header 派生——浏览器 body 只携 plan_id。
  const upstreamBody = JSON.stringify({ teamId: envelope.namespace, planId: parsed.data.plan_id })
  let upstream: Response
  try {
    upstream = await fetch(target, { method: "POST", headers, body: upstreamBody, cache: "no-store", signal: request.signal })
  } catch {
    return NextResponse.json({ error: "payment_unreachable" }, { status: 502 })
  }
  // 诚实态：501=支付渠道未开通（provider 未配置），原样透传，展示层据此禁用购买按钮。
  if (upstream.status === 501) {
    return NextResponse.json({ error: "checkout_unavailable" }, { status: 501 })
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: "checkout_failed" }, { status: 502 })
  }
  let raw: unknown
  try {
    raw = await upstream.json()
  } catch {
    return NextResponse.json({ error: "payment_bad_response" }, { status: 502 })
  }
  const ok = paymentCheckoutOkSchema.safeParse(raw)
  if (!ok.success) {
    return NextResponse.json({ error: "payment_bad_response" }, { status: 502 })
  }
  return NextResponse.json({ checkout_url: ok.data.data.checkoutUrl }, { status: 200 })
}
