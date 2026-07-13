import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEFAULT_BRAND,
  __clearSiteResolveCache,
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
  __clearSiteResolveCache()
  for (const k of Object.keys(SITE_ENV)) delete process.env[k]
})

describe("resolveSite", () => {
  it("returns env default site + default brand without a network call when base URL is unset", async () => {
    delete process.env.KOKORO_SITE_BASE_URL
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const site = await resolveSite("brand-a.com")
    expect(site.siteId).toBe("site-default")
    expect(site.brand).toEqual(DEFAULT_BRAND)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("falls back to env default when the host is missing", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const site = await resolveSite(null)
    expect(site.siteId).toBe("site-default")
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
    const fetchMock = vi.fn().mockResolvedValue(new Response("not found", { status: 404 }))
    vi.stubGlobal("fetch", fetchMock)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const site = await resolveSite("unbound.com")
    expect(site.siteId).toBe("site-default")
    expect(site.brand).toEqual(DEFAULT_BRAND)
    expect(warn).toHaveBeenCalled()
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
    delete process.env.KOKORO_SITE_ID
    delete process.env.KOKORO_SITE_BASE_URL

    expect(await resolveSiteId("brandco.com", "site-fallback")).toBe("site-fallback")
  })
})
