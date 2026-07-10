// 终端登录换签（P2 签发链的 web 端）：浏览器只见本路由,user 服务地址/站点 id 留在服务端。
// V1 dev-login:email 即外部身份(external_user_id),服务端调 kokoro-user /auth/sessions
// resolve-or-create + 签发 opaque-namespace JWT;magic-link 邮件验证是后续硬化,不改本接口形状。

import { NextResponse } from "next/server"
import { z } from "zod"

const bodySchema = z.object({ email: z.string().email() }).strict()

// user 服务响应只取本路由消费的字段（strip 未知键,不透传 platform 内部形状）。
const issuedSchema = z.object({
  data: z.object({
    token: z.string().min(1),
    namespace: z.string().min(1),
  }),
})

export async function POST(request: Request): Promise<NextResponse> {
  const userBase = process.env.KOKORO_USER_BASE_URL
  const siteId = process.env.KOKORO_SITE_ID
  if (!userBase || !siteId) {
    // 未接 platform 的部署（纯前端预览等）：明确 503,不带病假登录。
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 })
  }
  const upstream = await fetch(new URL("/auth/sessions", userBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ site_id: siteId, external_user_id: parsed.data.email }),
    cache: "no-store",
  }).catch(() => null)
  if (upstream === null || !upstream.ok) {
    return NextResponse.json({ error: "issuer_unavailable" }, { status: 502 })
  }
  const issued = issuedSchema.safeParse(await upstream.json().catch(() => null))
  if (!issued.success) {
    return NextResponse.json({ error: "issuer_unavailable" }, { status: 502 })
  }
  return NextResponse.json({
    token: issued.data.data.token,
    namespace: issued.data.data.namespace,
  })
}
