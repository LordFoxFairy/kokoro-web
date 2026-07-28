import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_BRAND,
  __clearSiteResolveCache,
  parseSiteResolveTimeoutMs,
  resolveSite,
  resolveSiteId,
} from "@/lib/server/site"

const SITE_ENV = {
  KOKORO_SITE_ID: "site-default",
  KOKORO_SITE_BASE_URL: "http://site.test",
}

function resolveResponse(siteId: string, brand: { name: string; logoUrl: string | null; themeColor: string | null }): Response {
  return new Response(JSON.stringify({ data: { context: { siteId, brand } } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}

beforeEach(() => {
  __clearSiteResolveCache()
  for (const [k, v] of Object.entries(SITE_ENV)) process.env[k] = v
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __clearSiteResolveCache()
  for (const k of Object.keys(SITE_ENV)) delete process.env[k]
  delete process.env.KOKORO_SITE_ALLOW_DEV_FALLBACK
  delete process.env.KOKORO_SITE_RESOLVE_TIMEOUT_MS
  delete process.env.KOKORO_SITE_STRICT
})

function enableDevelopmentFallback(): void {
  vi.stubEnv("NODE_ENV", "development")
  process.env.KOKORO_SITE_ALLOW_DEV_FALLBACK = "true"
}

describe("resolveSite", () => {
  it("returns env default site + default brand without a network call when base URL is unset", async () => {
    enableDevelopmentFallback()
    delete process.env.KOKORO_SITE_BASE_URL
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const site = await resolveSite("brand-a.com")
    expect(site?.siteId).toBe("site-default")
    expect(site?.brand).toEqual(DEFAULT_BRAND)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("falls back to env default when the host is missing", async () => {
    enableDevelopmentFallback()
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const site = await resolveSite(null)
    expect(site?.siteId).toBe("site-default")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("resolves site_id + brand from the site service and strips the port from the host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      resolveResponse("site-brandco", { name: "Brand Co", logoUrl: null, themeColor: "#ff5722" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const site = await resolveSite("BrandCo.com:3000")
    expect(site).toEqual({
      siteId: "site-brandco",
      brand: { name: "Brand Co", logoUrl: null, themeColor: "#ff5722" },
    })
    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.searchParams.get("host")).toBe("brandco.com")
  })

  it("caches by host within the TTL (single fetch for repeated calls)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      resolveResponse("site-brandco", { name: "Brand Co", logoUrl: null, themeColor: null }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await resolveSite("brandco.com")
    await resolveSite("brandco.com")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("falls back to env default + default brand and warns when the host is unresolved (non-200)", async () => {
    enableDevelopmentFallback()
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const site = await resolveSite("unbound.com")
    expect(site).not.toBeNull()
    expect(site?.siteId).toBe("site-default")
    expect(site?.brand).toEqual(DEFAULT_BRAND)
    expect(warn).toHaveBeenCalled()
  })

  it("does not cache a failed resolution — retries the site service on the next call", async () => {
    enableDevelopmentFallback()
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})

    await resolveSite("flaky.com")
    await resolveSite("flaky.com")
    // 失败不写缓存：两次都真发请求（site 服务抖动即时恢复，不被 30s 旧值粘住）。
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("strict mode: fail-closed to null on unresolved host (no default-brand fallback)", async () => {
    enableDevelopmentFallback()
    process.env.KOKORO_SITE_STRICT = "1"
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const site = await resolveSite("unbound.com")
    expect(site).toBeNull()
    expect(warn).toHaveBeenCalled()
    delete process.env.KOKORO_SITE_STRICT
  })

  it("production fails closed for an unresolved host even when the strict flag is omitted", async () => {
    vi.stubEnv("NODE_ENV", "production")
    delete process.env.KOKORO_SITE_STRICT
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(await resolveSite("unbound.com")).toBeNull()
    vi.unstubAllEnvs()
  })

  it("production fails closed without a configured Site resolver", async () => {
    vi.stubEnv("NODE_ENV", "production")
    delete process.env.KOKORO_SITE_BASE_URL
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    expect(await resolveSite("brand-a.com")).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("strict mode fails closed when the request Host is missing", async () => {
    enableDevelopmentFallback()
    process.env.KOKORO_SITE_STRICT = "1"
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    expect(await resolveSite(null)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("strict mode: still resolves normally when the site service resolves the host", async () => {
    process.env.KOKORO_SITE_STRICT = "true"
    const fetchMock = vi.fn().mockResolvedValue(
      resolveResponse("site-brandco", { name: "Brand Co", logoUrl: null, themeColor: null }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const site = await resolveSite("brandco.com")
    expect(site).toEqual({ siteId: "site-brandco", brand: { name: "Brand Co", logoUrl: null, themeColor: null } })
    delete process.env.KOKORO_SITE_STRICT
  })

  it.each(["test", "staging", ""])("%s environment fails closed even when the dev fallback flag is true", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv)
    process.env.KOKORO_SITE_ALLOW_DEV_FALLBACK = "true"
    delete process.env.KOKORO_SITE_BASE_URL
    expect(await resolveSite("brand-a.com")).toBeNull()
  })

  it("development also fails closed unless fallback is explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "development")
    delete process.env.KOKORO_SITE_ALLOW_DEV_FALLBACK
    delete process.env.KOKORO_SITE_BASE_URL
    expect(await resolveSite("brand-a.com")).toBeNull()
  })

  it("uses a bounded resolver timeout parser", () => {
    expect(parseSiteResolveTimeoutMs(undefined)).toBe(1_500)
    expect(parseSiteResolveTimeoutMs("not-a-number")).toBe(1_500)
    expect(parseSiteResolveTimeoutMs("1")).toBe(100)
    expect(parseSiteResolveTimeoutMs("999999")).toBe(5_000)
    expect(parseSiteResolveTimeoutMs("750")).toBe(750)
  })

  it("aborts a hung resolver at the configured timeout and returns null", async () => {
    vi.stubEnv("NODE_ENV", "production")
    process.env.KOKORO_SITE_RESOLVE_TIMEOUT_MS = "100"
    const fetchMock = vi.fn((_input: URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})

    const startedAt = Date.now()
    expect(await resolveSite("hung.example")).toBeNull()
    expect(Date.now() - startedAt).toBeLessThan(1_000)
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(init.signal?.aborted).toBe(true)
  })
})

describe("resolveSiteId", () => {
  it("returns the resolved site_id when the service resolves the host", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      resolveResponse("site-brandco", { name: "Brand Co", logoUrl: null, themeColor: null }),
    )
    vi.stubGlobal("fetch", fetchMock)

    expect(await resolveSiteId("brandco.com", "site-fallback")).toBe("site-brandco")
  })

  it("returns the provided fallback site_id when the service is unconfigured", async () => {
    enableDevelopmentFallback()
    delete process.env.KOKORO_SITE_ID
    delete process.env.KOKORO_SITE_BASE_URL

    expect(await resolveSiteId("brandco.com", "site-fallback")).toBe("site-fallback")
  })

  it("returns null under strict fail-closed instead of binding auth to a fallback Site", async () => {
    process.env.KOKORO_SITE_STRICT = "1"
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(await resolveSiteId("unbound.com", "site-fallback")).toBeNull()
    delete process.env.KOKORO_SITE_STRICT
  })

  it("returns null when the Site resolver is unavailable in production", async () => {
    vi.stubEnv("NODE_ENV", "production")
    const fetchMock = vi.fn().mockRejectedValue(new Error("site resolver unavailable"))
    vi.stubGlobal("fetch", fetchMock)
    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(await resolveSiteId("brand-a.com", "site-fallback")).toBeNull()
  })
})
