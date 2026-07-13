// host→site 解析（SITE-REAL，服务端专用）：从请求 Host 经 kokoro-site 的 resolve 端点定 site_id + 品牌，
// 替换 KOKORO_SITE_ID 单站点常量。结果按 host 短 TTL 缓存；解析失败/未接 site 服务 → 退回 env 缺省
// 站点 + 默认品牌并 WARN（迁移期安全网，见 SITE-REAL-FALLBACK，待 Wave6 收紧）。

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
export async function resolveSite(
  host: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedSite> {
  const baseUrl = env.KOKORO_SITE_BASE_URL?.trim()
  const normalizedHost = normalizeHost(host)
  if (!baseUrl || !normalizedHost) {
    // SITE-REAL-FALLBACK: 迁移期安全网——未接 site 服务即退回 env 缺省站点，不阻断渲染。
    return fallbackSite(env)
  }

  const now = Date.now()
  const cached = cache.get(normalizedHost)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const resolved = await fetchResolved(baseUrl, normalizedHost, env)
  if (resolved === null) {
    // SITE-REAL-FALLBACK: host 未命中/解析失败 → env 缺省站点 + 默认品牌 + WARN，不 500。
    console.warn(`[site-resolve] host=${normalizedHost} unresolved; falling back to env default site`)
  }
  const value = resolved ?? fallbackSite(env)
  cache.set(normalizedHost, { value, expiresAt: now + CACHE_TTL_MS })
  return value
}

// 仅取 site_id（auth 流用）：解析失败退回传入的 env 缺省 site_id，保持未接 site 服务时行为不变。
export async function resolveSiteId(
  host: string | null | undefined,
  fallbackSiteId: string,
): Promise<string> {
  const site = await resolveSite(host)
  return site.siteId || fallbackSiteId
}

// 便于测试重置进程内缓存。
export function __clearSiteResolveCache(): void {
  cache.clear()
}
