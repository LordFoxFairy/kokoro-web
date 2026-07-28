// magic-link 回调（BFF）：校验 nonce cookie（绑定申请设备）→ 带 nonce 哈希调 user consume →
// 把签发结果密封进 httpOnly 信封 cookie → 303 回 `/`（URL 不带 token），Referrer-Policy: no-referrer。
// nonce 缺失/不匹配、token 无效、consume 失败一律 303 到 `/?auth=link_unavailable`（不泄露账号存在性）。

import { NextResponse } from "next/server"

import {
  authConfig,
  decodeJwtExp,
  hashNonce,
  NONCE_COOKIE,
  readCookie,
  SESSION_COOKIE,
  sessionCookieOptions,
  userConsumeMagicLink,
  type AuthConfig,
} from "@/lib/server/auth"
import { sealEnvelope } from "@/lib/server/session-envelope"
import { resolveSiteId } from "@/lib/server/site"

export const runtime = "nodejs"

// 相对 Location 的 303：浏览器留在它实际寻址的 host（dev 下 request.url 会规整成 localhost，
// 用它构造绝对跳转会把 host 从 127.0.0.1 翻走，导致 cookie 跨 host 丢失）。相对跳转天然同 host。
function seeOther(location: string): NextResponse {
  return new NextResponse(null, {
    status: 303,
    headers: { location, "Referrer-Policy": "no-referrer" },
  })
}

// 统一失败落点：清 nonce、no-referrer、303 到带提示的首页（页面给重新发送入口）。
function failRedirect(config: AuthConfig | null): NextResponse {
  const response = seeOther("/?auth=link_unavailable")
  if (config !== null) {
    response.cookies.set(NONCE_COOKIE, "", { ...sessionCookieOptions(config, 0) })
  }
  return response
}

export async function GET(request: Request): Promise<NextResponse> {
  const config = authConfig()
  if (config === null) {
    return failRedirect(null)
  }

  const token = new URL(request.url).searchParams.get("token")
  const nonce = readCookie(request, NONCE_COOKIE)
  if (token === null || token.length === 0 || nonce === null) {
    // token 缺失，或跨设备打开（无 nonce cookie）→ 统一失败。
    return failRedirect(config)
  }

  // Host→Site 是认证签发的前置准入：strict/production 解析失败时不得先消费一次性 token，
  // 更不得把身份静默绑定到部署缺省 Site。
  const siteId = await resolveSiteId(request.headers.get("host"), config.siteId)
  if (siteId === null) {
    return failRedirect(config)
  }

  const consumed = await userConsumeMagicLink(config, token, hashNonce(nonce), siteId)
  if (consumed === null || consumed.site_id !== siteId) {
    return failRedirect(config)
  }

  const nowSec = Math.floor(Date.now() / 1000)
  // access_exp 对齐 runtime_jwt exp（代理据此判该不该续）；解不出给 1h 兜底。
  const accessExp = decodeJwtExp(consumed.token) ?? nowSec + 3600
  // 信封/cookie 寿命 = refresh 寿命（30 天）：access 过期后信封仍在，代理才拿得到 refresh 去续。
  const refreshExpMs = new Date(consumed.refresh_expires_at).getTime()
  const refreshExp = Number.isFinite(refreshExpMs) ? Math.floor(refreshExpMs / 1000) : nowSec + 2_592_000
  const maxAge = Math.max(0, refreshExp - nowSec)
  const sealed = sealEnvelope(
    {
      runtime_jwt: consumed.token,
      access_exp: accessExp,
      refresh_token: consumed.refresh_token,
      user_id: consumed.user.id,
      namespace: consumed.namespace,
      site_id: siteId,
      exp: refreshExp,
    },
    config.sessionSecrets,
  )

  const response = seeOther("/")
  response.cookies.set(SESSION_COOKIE, sealed, sessionCookieOptions(config, maxAge))
  // 一次性 nonce 用毕即清。
  response.cookies.set(NONCE_COOKIE, "", { ...sessionCookieOptions(config, 0) })
  return response
}
