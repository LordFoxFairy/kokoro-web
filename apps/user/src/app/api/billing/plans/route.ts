// 套餐目录 BFF：读信封 → 将当前 Host 重新解析并与信封 Site 绑定 → 注入 web-bff caller 凭据
// + x-kokoro-site-id（浏览器无从伪造）
// → 转发到 kokoro-payment 的 GET /plans（在售套餐读面）。payment 属外部边界：校验其响应形状，
// 把 camelCase + {data} 信封归一成 web 面 snake_case {plans}，浏览器只见同源 `/api/billing/plans`。
// paymentBaseUrl 未配置（预览档）→ 503，展示层据此渲染「套餐目录不可用」诚实态。

import { NextResponse } from "next/server"
import { z } from "zod"

import { authConfig, INTERNAL_SECRET_HEADER, readEnvelope, SERVICE_HEADER, SERVICE_VALUE } from "@/lib/server/auth"
import { PAYMENT_RESPONSE_BODY_MAX_BYTES, readBoundedResponseJson } from "@/lib/server/http-boundary"
import { resolveSiteId } from "@/lib/server/site"
import { isUpstreamTimeoutError, withUpstreamDeadline } from "@/lib/server/upstream"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const SITE_ID_HEADER = "x-kokoro-site-id"

// payment storefront 响应（camelCase + {data} 信封）：未知字段默认剥离，形状不符即抛 → BFF 归 502。
const paymentPlansEnvelopeSchema = z.object({
  data: z.object({
    plans: z.array(
      z.object({
        id: z.string().min(1),
        key: z.string().min(1),
        name: z.string().min(1),
        currency: z.string().min(1),
        amountMinor: z.string().min(1),
        creditMicros: z.string().min(1),
        billingInterval: z.enum(["once", "month", "year"]),
      }),
    ),
  }),
})

export async function GET(request: Request): Promise<Response> {
  const config = authConfig()
  if (config === null) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  const envelope = readEnvelope(request, config)
  if (envelope === null) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }
  let siteId: string | null
  try {
    siteId = await resolveSiteId(request.headers.get("host"), config.siteId, request.signal)
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      return NextResponse.json({ error: "upstream_timeout" }, { status: 504 })
    }
    throw error
  }
  if (siteId === null || siteId !== envelope.site_id) {
    return NextResponse.json({ error: "site_unresolved" }, { status: 404 })
  }
  if (config.paymentBaseUrl === null) {
    // 未接 payment 服务（预览档）：价格目录不可用，展示层据此降级为未开通态。
    return NextResponse.json({ error: "payment_not_configured" }, { status: 503 })
  }

  const headers = new Headers()
  headers.set(SERVICE_HEADER, SERVICE_VALUE)
  if (config.internalSecret !== null) {
    headers.set(INTERNAL_SECRET_HEADER, config.internalSecret)
  }
  // 站点身份从信封派生（web 侧解封结果），浏览器无从伪造。
  headers.set(SITE_ID_HEADER, siteId)

  const target = `${config.paymentBaseUrl.replace(/\/+$/, "")}/plans`
  let upstream: Response
  let raw: unknown
  try {
    const result = await withUpstreamDeadline(request.signal, config.upstreamTimeoutMs, async (signal) => {
      const response = await fetch(target, { method: "GET", headers, cache: "no-store", signal })
      const body = response.ok
        ? await readBoundedResponseJson(response, PAYMENT_RESPONSE_BODY_MAX_BYTES)
        : null
      return { upstream: response, raw: body }
    })
    upstream = result.upstream
    raw = result.raw
  } catch (error) {
    if (isUpstreamTimeoutError(error)) {
      return NextResponse.json({ error: "upstream_timeout" }, { status: 504 })
    }
    return NextResponse.json({ error: "payment_unreachable" }, { status: 502 })
  }
  if (!upstream.ok) {
    return NextResponse.json({ error: "payment_error" }, { status: 502 })
  }
  const parsed = paymentPlansEnvelopeSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: "payment_bad_response" }, { status: 502 })
  }
  // camelCase → web 面 snake_case（与 billing_summary 等 web 契约同风格）。
  const plans = parsed.data.data.plans.map((plan) => ({
    id: plan.id,
    key: plan.key,
    name: plan.name,
    currency: plan.currency,
    amount_minor: plan.amountMinor,
    credit_micros: plan.creditMicros,
    billing_interval: plan.billingInterval,
  }))
  return NextResponse.json({ plans }, { status: 200 })
}
