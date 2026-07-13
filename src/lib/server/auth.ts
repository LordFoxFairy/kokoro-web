// BFF 鉴权装配（服务端专用，勿从 client 组件 import）：配置读取、nonce、出站凭据、
// 对 kokoro-user 的 magic-link 调用、cookie 选项。浏览器只见本层暴露的同源路由，
// user/session 服务地址与站点 id 全留服务端。

import { createHash, randomBytes } from "node:crypto"
import { z } from "zod"

import { openEnvelope, type EnvelopePayload } from "./session-envelope"

// 信封 cookie（httpOnly，浏览器 JS 读不到）与一次性 nonce cookie（绑定申请设备）。
export const SESSION_COOKIE = "kokoro_session"
export const NONCE_COOKIE = "kokoro_auth_nonce"

// 出站服务身份（TRUST 子 spec 冻结）：web-bff caller 凭据。TRUST 合流前 user 侧不校验=直通。
export const SERVICE_HEADER = "x-kokoro-service"
export const SERVICE_VALUE = "web-bff"
export const INTERNAL_SECRET_HEADER = "x-kokoro-internal-secret"

// nonce cookie 存活：对齐 magic-link TTL 上限（user 侧默认 900s），跨设备打开链接时此 cookie 缺失。
const NONCE_MAX_AGE_SECONDS = 900

export interface AuthConfig {
  // 逗号分隔的信封密钥，[0]=current 封，全部用于解（双钥轮换）。
  sessionSecrets: string[]
  userBaseUrl: string
  sessionBaseUrl: string
  siteId: string
  hubBaseUrl: string | null
  // payment 服务面（经网关到 kokoro-payment）；未配置=预览档（PAY-2 价格页据此降级为诚实未开通态）。
  paymentBaseUrl: string | null
  // web-bff 出站内部凭据；未配置=直通（TRUST 合流前）。
  internalSecret: string | null
  secureCookies: boolean
  // 仅非生产：把 user 的 response 投递档 link_token 变成可点开发链接回给前端。
  revealDevLink: boolean
}

// 四项齐备才算「已接 platform」；缺任一 = 预览档（纯前端），路由回 503/preview，登录闸放行。
export function authConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig | null {
  const secretRaw = env.KOKORO_WEB_SESSION_SECRET?.trim()
  const userBaseUrl = env.KOKORO_USER_BASE_URL?.trim()
  const sessionBaseUrl = env.KOKORO_SESSION_BASE_URL?.trim()
  const siteId = env.KOKORO_SITE_ID?.trim()
  if (!secretRaw || !userBaseUrl || !sessionBaseUrl || !siteId) {
    return null
  }
  const sessionSecrets = secretRaw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  if (sessionSecrets.length === 0) {
    return null
  }
  return {
    sessionSecrets,
    userBaseUrl,
    sessionBaseUrl,
    siteId,
    hubBaseUrl: env.KOKORO_HUB_BASE_URL?.trim() || null,
    paymentBaseUrl: env.KOKORO_PAYMENT_BASE_URL?.trim() || null,
    internalSecret: env.KOKORO_INTERNAL_SECRET_WEB_BFF?.trim() || null,
    secureCookies: env.NODE_ENV === "production",
    revealDevLink: env.NODE_ENV !== "production",
  }
}

export function newNonce(): string {
  return randomBytes(32).toString("base64url")
}

export function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce, "utf8").digest("hex")
}

// runtime_jwt 的 exp（epoch 秒）：信封 exp 与 cookie Max-Age 都对齐它。仅解码不验签
// （本 token 刚从 user 内部调用取回，session 侧才是验签权威）。
export function decodeJwtExp(jwt: string): number | null {
  const parts = jwt.split(".")
  if (parts.length !== 3) {
    return null
  }
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"))
    if (typeof payload === "object" && payload !== null && "exp" in payload) {
      const exp = (payload as { exp: unknown }).exp
      return typeof exp === "number" && Number.isFinite(exp) ? exp : null
    }
    return null
  } catch {
    return null
  }
}

export interface CookieOptions {
  httpOnly: true
  sameSite: "lax"
  secure: boolean
  path: "/"
  maxAge: number
}

export function sessionCookieOptions(config: AuthConfig, maxAgeSeconds: number): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: "/", maxAge: maxAgeSeconds }
}

export function nonceCookieOptions(config: AuthConfig): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure: config.secureCookies, path: "/", maxAge: NONCE_MAX_AGE_SECONDS }
}

// 出站到 user/hub 的服务身份头（+ 可选内部凭据）。
export function callerHeaders(config: AuthConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [SERVICE_HEADER]: SERVICE_VALUE,
  }
  if (config.internalSecret !== null) {
    headers[INTERNAL_SECRET_HEADER] = config.internalSecret
  }
  return headers
}

// 变更类请求的同源守卫（纵深防御，SameSite=Lax 已挡跨站 POST 携带 cookie）：
// Origin 存在且 host 不符 → 拒；缺失（同源导航/非浏览器）→ 放行交 SameSite 兜底。
// 比对 Origin 与 Host 请求头（浏览器实际寻址的权威）——dev 下 request.url 会被规整成 localhost，
// 与浏览器的 127.0.0.1 主机不符，故不能用它；Host 缺失时（部分测试）回退 request.url。
export function sameOriginOk(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (origin === null) {
    return true
  }
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    return false
  }
  const hostHeader = request.headers.get("host")
  if (hostHeader !== null) {
    return originHost === hostHeader
  }
  try {
    return originHost === new URL(request.url).host
  } catch {
    return false
  }
}

// 从请求 cookie 读并解封信封；无/失效 → null。
export function readEnvelope(request: Request, config: AuthConfig): EnvelopePayload | null {
  const raw = readCookie(request, SESSION_COOKIE)
  if (raw === null) {
    return null
  }
  return openEnvelope(raw, config.sessionSecrets, Math.floor(Date.now() / 1000))
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie")
  if (header === null) {
    return null
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=")
    if (eq === -1) {
      continue
    }
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim())
    }
  }
  return null
}

// user 的统一响应包 { data, requestId }。
const consumeResponseSchema = z.object({
  data: z.object({
    token: z.string().min(1),
    namespace: z.string().min(1),
    user: z.object({ id: z.string().min(1) }).passthrough(),
    team: z.object({ id: z.string().min(1) }).passthrough(),
  }),
})

export type ConsumeResult = z.infer<typeof consumeResponseSchema>["data"]

const requestResponseSchema = z.object({
  data: z.object({
    email: z.string(),
    expires_at: z.string(),
    // response 投递档才有；log 档无（原文只在 user 服务侧）。
    link_token: z.string().optional(),
  }),
})

export type MagicLinkRequestOutcome =
  | { kind: "ok"; linkToken: string | null }
  | { kind: "rate_limited" }
  | { kind: "unavailable" }

// 申请：把 nonce 哈希随邮箱交 user。存在性不泄露——除限频外一律等价「已发送」。
// siteId 由调用方按请求 Host 解析后传入（SITE-REAL）；不传则回退 config 的 env 缺省站点。
export async function userRequestMagicLink(
  config: AuthConfig,
  email: string,
  nonceHash: string,
  siteId: string = config.siteId,
): Promise<MagicLinkRequestOutcome> {
  const response = await fetch(new URL("/auth/magic-links", config.userBaseUrl), {
    method: "POST",
    headers: callerHeaders(config),
    body: JSON.stringify({ site_id: siteId, email, nonce_hash: nonceHash }),
    cache: "no-store",
  }).catch(() => null)
  if (response === null) {
    return { kind: "unavailable" }
  }
  if (response.status === 429) {
    return { kind: "rate_limited" }
  }
  if (!response.ok) {
    return { kind: "unavailable" }
  }
  const parsed = requestResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    return { kind: "unavailable" }
  }
  return { kind: "ok", linkToken: parsed.data.data.link_token ?? null }
}

export type TeamSessionOutcome =
  | { kind: "ok"; result: ConsumeResult }
  | { kind: "forbidden" }
  | { kind: "unavailable" }

// 团队换签（web → user /bff/auth/team-sessions）：携 user principal（x-user-id）换目标 namespace 的
// runtime token。403=非该 team 活跃成员（被移除/从未加入）；其余失败归一 unavailable。token 只在服务端
// 重新密封进信封，绝不回给浏览器。
export async function userIssueTeamSession(
  config: AuthConfig,
  userId: string,
  teamId: string,
): Promise<TeamSessionOutcome> {
  const response = await fetch(new URL("/bff/auth/team-sessions", config.userBaseUrl), {
    method: "POST",
    headers: { ...callerHeaders(config), "x-user-id": userId },
    body: JSON.stringify({ team_id: teamId }),
    cache: "no-store",
  }).catch(() => null)
  if (response === null) {
    return { kind: "unavailable" }
  }
  if (response.status === 403) {
    return { kind: "forbidden" }
  }
  if (!response.ok) {
    return { kind: "unavailable" }
  }
  const parsed = consumeResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    return { kind: "unavailable" }
  }
  return { kind: "ok", result: parsed.data.data }
}

// 消费：带回同一 nonce 哈希。任何失败都归一为 null（跨设备/无效/已用/过期不区分）。
export async function userConsumeMagicLink(
  config: AuthConfig,
  token: string,
  nonceHash: string,
): Promise<ConsumeResult | null> {
  const response = await fetch(new URL("/auth/magic-links/consume", config.userBaseUrl), {
    method: "POST",
    headers: callerHeaders(config),
    body: JSON.stringify({ token, nonce_hash: nonceHash }),
    cache: "no-store",
  }).catch(() => null)
  if (response === null || !response.ok) {
    return null
  }
  const parsed = consumeResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    return null
  }
  return parsed.data.data
}
