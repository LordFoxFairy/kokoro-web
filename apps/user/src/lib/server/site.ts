// host→site 解析（SITE-REAL，服务端专用）：从请求 Host 经 kokoro-site 的 resolve 端点定 site_id + 品牌，
// 替换 KOKORO_SITE_ID 单站点常量。**仅成功解析**按 host 短 TTL 缓存——解析失败/未命中不写缓存，
// site 服务抖动即时恢复（不被 30s 旧值粘住）。
// FALLBACK 语义（SITE-REAL-FALLBACK）：
//   - 仅 NODE_ENV=development 且 KOKORO_SITE_ALLOW_DEV_FALLBACK=true：解析失败才允许退回 env 缺省站点。
//   - 其他环境、未显式开启或显式 strict：resolver 未配置、Host 缺失或解析失败 → fail-closed 回 null，
//     上游渲染中性无品牌 404，不退默认品牌（防多租户品牌串味）。

import { z } from "zod"

import { readBoundedResponseJson, SITE_RESPONSE_BODY_MAX_BYTES } from "./http-boundary"
import { isUpstreamTimeoutError, withUpstreamDeadline } from "./upstream"

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
const DEFAULT_RESOLVE_TIMEOUT_MS = 1_500
const MIN_RESOLVE_TIMEOUT_MS = 100
const MAX_RESOLVE_TIMEOUT_MS = 5_000

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

function isExplicitStrictMode(env: NodeJS.ProcessEnv): boolean {
  const value = env.KOKORO_SITE_STRICT?.trim().toLowerCase()
  return value === "1" || value === "true"
}

function allowsDevelopmentFallback(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NODE_ENV === "development" &&
    env.KOKORO_SITE_ALLOW_DEV_FALLBACK?.trim().toLowerCase() === "true" &&
    !isExplicitStrictMode(env)
  )
}

export function parseSiteResolveTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RESOLVE_TIMEOUT_MS
  const normalized = raw.trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(
      `KOKORO_SITE_RESOLVE_TIMEOUT_MS must be an integer between ${MIN_RESOLVE_TIMEOUT_MS} and ${MAX_RESOLVE_TIMEOUT_MS}`,
    )
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed < MIN_RESOLVE_TIMEOUT_MS || parsed > MAX_RESOLVE_TIMEOUT_MS) {
    throw new Error(
      `KOKORO_SITE_RESOLVE_TIMEOUT_MS must be an integer between ${MIN_RESOLVE_TIMEOUT_MS} and ${MAX_RESOLVE_TIMEOUT_MS}`,
    )
  }
  return parsed
}

async function fetchResolved(
  baseUrl: string,
  host: string,
  env: NodeJS.ProcessEnv,
  requestSignal?: AbortSignal,
  propagateTimeout = false,
): Promise<ResolvedSite | null> {
  const url = new URL("/site-context/resolve", baseUrl)
  url.searchParams.set("host", host)
  // 出站服务身份：复用 web-bff caller 头（+ 可选内部凭据）。
  const headers: Record<string, string> = { "x-kokoro-service": "web-bff" }
  const secret = env.KOKORO_INTERNAL_SECRET_WEB_BFF?.trim()
  if (secret) {
    headers["x-kokoro-internal-secret"] = secret
  }
  try {
    return await withUpstreamDeadline(
      requestSignal,
      parseSiteResolveTimeoutMs(env.KOKORO_SITE_RESOLVE_TIMEOUT_MS),
      async (signal) => {
        const response = await fetch(url, { headers, cache: "no-store", signal })
        if (!response.ok) return null
        const parsed = resolveResponseSchema.safeParse(
          await readBoundedResponseJson(response, SITE_RESPONSE_BODY_MAX_BYTES),
        )
        if (!parsed.success) return null
        const { context } = parsed.data.data
        return { siteId: context.siteId, brand: context.brand }
      },
    )
  } catch (error) {
    if (propagateTimeout && isUpstreamTimeoutError(error)) throw error
    return null
  }
}

// 按请求 Host 解析站点。仅显式 development+allow flag 允许 resolver 未配置或 Host 缺失时回退。
// 其他所有运行环境均 fail-closed，上游据此渲染中性无品牌 404。
export async function resolveSite(
  host: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  requestSignal?: AbortSignal,
  propagateTimeout = false,
): Promise<ResolvedSite | null> {
  const baseUrl = env.KOKORO_SITE_BASE_URL?.trim()
  const normalizedHost = normalizeHost(host)
  if (!baseUrl || !normalizedHost) {
    if (allowsDevelopmentFallback(env)) {
      return fallbackSite(env)
    }
    console.warn("[site-resolve] resolver or Host unavailable; fail-closed 404")
    return null
  }

  const now = Date.now()
  const cached = cache.get(normalizedHost)
  if (cached && cached.expiresAt > now) {
    return cached.value
  }

  const resolved = await fetchResolved(baseUrl, normalizedHost, env, requestSignal, propagateTimeout)
  if (resolved === null) {
    // 未命中/解析失败：**不写缓存**（site 服务抖动即时恢复，不被 30s 旧值粘住）。
    if (allowsDevelopmentFallback(env)) {
      console.warn(`[site-resolve] host=${normalizedHost} unresolved; explicit development fallback`)
      return fallbackSite(env)
    }
    console.warn(`[site-resolve] host=${normalizedHost} unresolved; fail-closed 404`)
    return null
  }
  // 仅缓存成功解析。
  cache.set(normalizedHost, { value: resolved, expiresAt: now + CACHE_TTL_MS })
  return resolved
}

// 仅取 site_id（auth/BFF 流用）：解析失败必须保持 null；fallbackSiteId 只服务显式开发 fallback。
export async function resolveSiteId(
  host: string | null | undefined,
  fallbackSiteId: string,
  requestSignal?: AbortSignal,
): Promise<string | null> {
  const site = await resolveSite(host, process.env, requestSignal, true)
  if (site?.siteId) {
    return site.siteId
  }
  return allowsDevelopmentFallback(process.env) ? fallbackSiteId : null
}

// 便于测试重置进程内缓存。
export function __clearSiteResolveCache(): void {
  cache.clear()
}
