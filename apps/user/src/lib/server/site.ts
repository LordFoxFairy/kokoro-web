// host→site 解析（SITE-REAL，服务端专用）：从请求 Host 经 kokoro-site 的 resolve 端点定 site_id + 品牌，
// 替换 KOKORO_SITE_ID 单站点常量。**仅成功解析**按 host 短 TTL 缓存——解析失败/未命中不写缓存，
// site 服务抖动即时恢复（不被 30s 旧值粘住）。
// FALLBACK 语义（SITE-REAL-FALLBACK）：
//   - 非生产且 KOKORO_SITE_STRICT 未开：解析失败 → 退回 env 缺省站点 + 默认品牌 + WARN（开发安全网）。
//   - production 或显式 strict（且已配 KOKORO_SITE_BASE_URL）：解析失败 → fail-closed 回 null，
//     上游渲染中性无品牌 404，不退默认品牌（防多租户品牌串味）。

import { z } from "zod"

export interface SiteBrand {
  name: string
  logoUrl: string | null
  themeColor: string | null
}

export interface ResolvedSite {
  siteId: string
  brand: SiteBrand
}

// 未解析出站点时的默认品牌：与硬编码历史一致（心/Kokoro）。
export const DEFAULT_BRAND: SiteBrand = { name: "Kokoro", logoUrl: null, themeColor: null }

const CACHE_TTL_MS = 30_000

const resolveResponseSchema = z.object({
  data: z.object({
    context: z.object({
      siteId: z.string().min(1),
      brand: z.object({
        name: z.string().min(1),
        logoUrl: z.string().nullable(),
        themeColor: z.string().nullable(),
      }),
    }),
  }),
})

interface CacheEntry {
  value: ResolvedSite
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()

// Host 头（可能带端口/大小写/IPv6 括号）归一为纯 hostname，与 site 域名表的 host 对齐。
function normalizeHost(host: string | null | undefined): string | null {
  if (!host) {
    return null
  }
  try {
    return new URL(`http://${host}`).hostname.toLowerCase()
  } catch {
    return null
  }
}

function fallbackSite(env: NodeJS.ProcessEnv): ResolvedSite {
  return { siteId: env.KOKORO_SITE_ID?.trim() ?? "", brand: DEFAULT_BRAND }
}

// strict 档开关：开启且已配 site 服务时，解析失败走 fail-closed（不退默认品牌）。
function isStrictMode(env: NodeJS.ProcessEnv): boolean {
  const value = env.KOKORO_SITE_STRICT?.trim().toLowerCase()
  return env.NODE_ENV === "production" || value === "1" || value === "true"
}

async function fetchResolved(
  baseUrl: string,
  host: string,
  env: NodeJS.ProcessEnv,
): Promise<ResolvedSite | null> {
  const url = new URL("/site-context/resolve", baseUrl)
  url.searchParams.set("host", host)
  // 出站服务身份：复用 web-bff caller 头（+ 可选内部凭据）。
  const headers: Record<string, string> = { "x-kokoro-service": "web-bff" }
  const secret = env.KOKORO_INTERNAL_SECRET_WEB_BFF?.trim()
  if (secret) {
    headers["x-kokoro-internal-secret"] = secret
  }
  const response = await fetch(url, { headers, cache: "no-store" }).catch(() => null)
  if (response === null || !response.ok) {
    return null
  }
  const parsed = resolveResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) {
    return null
  }
  const { context } = parsed.data.data
  return { siteId: context.siteId, brand: context.brand }
}

// 按请求 Host 解析站点。未配置 KOKORO_SITE_BASE_URL 或 host 缺失 → 直接退回 env 缺省（不发网络）。
// 返回 null 仅在 strict 档解析失败时出现（fail-closed），上游据此渲染中性无品牌 404。
export async function resolveSite(
  host: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedSite | null> {
  const baseUrl = env.KOKORO_SITE_BASE_URL?.trim()
  const normalizedHost = normalizeHost(host)
  if (!baseUrl || !normalizedHost) {
    // 未接 site 服务或无 host：退回 env 缺省站点，不阻断渲染（strict 不生效——无可解析对象）。
    return fallbackSite(env)
  }

  const now = Date.now()
  const cached = cache.get(normalizedHost)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const resolved = await fetchResolved(baseUrl, normalizedHost, env)
  if (resolved === null) {
    // 未命中/解析失败：**不写缓存**（site 服务抖动即时恢复，不被 30s 旧值粘住）。
    if (isStrictMode(env)) {
      // fail-closed：strict 档不退默认品牌，回 null → 上游渲染中性无品牌 404，防多租户品牌串味。
      console.warn(`[site-resolve] host=${normalizedHost} unresolved; strict mode → fail-closed 404`)
      return null
    }
    console.warn(`[site-resolve] host=${normalizedHost} unresolved; falling back to env default site`)
    return fallbackSite(env)
  }
  // 仅缓存成功解析。
  cache.set(normalizedHost, { value: resolved, expiresAt: now + CACHE_TTL_MS })
  return resolved
}

// 仅取 site_id（auth 流用）：解析失败/strict fail-closed 均退回传入的 env 缺省 site_id
// （auth 绑定本部署自有站点，不受品牌 fail-closed 影响；品牌串味风险只在页面品牌渲染面）。
export async function resolveSiteId(
  host: string | null | undefined,
  fallbackSiteId: string,
): Promise<string> {
  const site = await resolveSite(host)
  return site?.siteId || fallbackSiteId
}

// 便于测试重置进程内缓存。
export function __clearSiteResolveCache(): void {
  cache.clear()
}
