// magic-link 申请（BFF）：设一次性 httpOnly nonce cookie，把 nonce 哈希随邮箱交 kokoro-user。
// 浏览器不收 site_id/user 地址，也不收原文 token（原文只经邮件/开发链投递）。存在性不泄露：
// 除限频外一律等价「已发送」。dev（response 投递档）把 link_token 变可点开发链回前端。

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  authConfig,
  hashNonce,
  NONCE_COOKIE,
  newNonce,
  nonceCookieOptions,
  sameOriginOk,
  userRequestMagicLink,
} from "@/lib/server/auth"

export const runtime = "nodejs"

const bodySchema = z.object({ email: z.string().email() }).strict()

export async function POST(request: Request): Promise<NextResponse> {
  const config = authConfig()
  if (config === null) {
    // 未接 platform（纯前端预览）：明确 503，登录闸据此放行。
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 })
  }
  if (!sameOriginOk(request)) {
    return NextResponse.json({ error: "forbidden_origin" }, { status: 403 })
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 })
  }

  const nonce = newNonce()
  const outcome = await userRequestMagicLink(config, parsed.data.email, hashNonce(nonce))

  if (outcome.kind === "rate_limited") {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 })
  }
  if (outcome.kind === "unavailable") {
    return NextResponse.json({ error: "auth_link_unavailable" }, { status: 502 })
  }

  // dev 便利：response 投递档下把原文 token 包成同源可点回执链（仅非生产）。生产为 null。
  const devLink =
    config.revealDevLink && outcome.linkToken !== null
      ? `/api/auth/callback?token=${encodeURIComponent(outcome.linkToken)}`
      : null

  const response = NextResponse.json({ status: "sent", ...(devLink !== null ? { dev_link: devLink } : {}) })
  // 一次性 nonce cookie：绑定本设备；跨设备打开链接时缺失 → 回调统一失败。
  response.cookies.set(NONCE_COOKIE, nonce, nonceCookieOptions(config))
  return response
}
