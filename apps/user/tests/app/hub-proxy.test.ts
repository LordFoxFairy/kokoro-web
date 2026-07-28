import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"
import { __clearSiteResolveCache } from "@/lib/server/site"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_BASE_URL: "http://site.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_HUB_BASE_URL: "http://hub.test",
  KOKORO_INTERNAL_SECRET_WEB_BFF: "svc-secret",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function sessionCookie(siteId = "site-a", accessExp = nowSec() + 3600): string {
  const sealed = sealEnvelope(
    { runtime_jwt: "rt.jwt.sig", access_exp: accessExp, refresh_token: "rt-refresh", user_id: "u1", namespace: "team_1", site_id: siteId, exp: nowSec() + 3600 },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )
  return `kokoro_session=${sealed}`
}

function siteResponse(siteId: string): Response {
  return Response.json({
    data: {
      context: {
        siteId,
        brand: { name: siteId, logoUrl: null, themeColor: null },
      },
    },
  })
}

function refreshResponse(siteId = "site-a"): Response {
  return Response.json({
    data: {
      token: "new.jwt.sig",
      namespace: "team_1",
      site_id: siteId,
      refresh_token: "rotated-refresh",
      refresh_expires_at: new Date((nowSec() + 3600) * 1000).toISOString(),
    },
  })
}

function params(path: string[]): { params: Promise<{ path: string[] }> } {
  return { params: Promise.resolve({ path }) }
}

function chunkedPost(url: string, chunks: Uint8Array[], headers: Record<string, string>): Request {
  let index = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++]
      if (chunk === undefined) {
        controller.close()
      } else {
        controller.enqueue(chunk)
      }
    },
  })
  return new Request(url, {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" })
}

function uploadRequest(chunks: Uint8Array[], contentLength?: number): Request {
  return chunkedPost("http://localhost/api/hub/self/skills/upload/preview", chunks, {
    cookie: sessionCookie(),
    host: "site-a.example",
    origin: "http://site-a.example",
    "content-type": "multipart/form-data; boundary=test",
    ...(contentLength === undefined ? {} : { "content-length": String(contentLength) }),
  })
}

beforeEach(() => {
  __clearSiteResolveCache()
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
  vi.stubEnv("NODE_ENV", "production")
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  __clearSiteResolveCache()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe("/api/hub/[...path] proxy", () => {
  it("injects web-bff caller creds + envelope scope/user and prefixes /hub", async () => {
    const fetchMock = vi.fn(async (target: string | URL, _init?: RequestInit) => {
      void _init
      return target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response('{"data":{"skills":[]}}', {
            status: 200,
            headers: { "content-type": "application/json" },
          })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie(), host: "site-a.example" },
      }),
      params(["self", "skills", "pool"]),
    )
    expect(res.status).toBe(200)

    const [target, init] = fetchMock.mock.calls[1]!
    expect(target.toString()).toBe("http://hub.test/hub/self/skills/pool")
    const headers = init!.headers as Headers
    expect(headers.get("x-kokoro-service")).toBe("web-bff")
    expect(headers.get("x-kokoro-internal-secret")).toBe("svc-secret")
    expect(headers.get("x-kokoro-namespace")).toBe("team_1")
    expect(headers.get("x-kokoro-user-id")).toBe("u1")
  })

  it("never forwards a browser-supplied scope header (identity from envelope only)", async () => {
    const fetchMock = vi.fn(async (target: string | URL, _init?: RequestInit) => {
      void _init
      return target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response('{"data":{"skills":[]}}', {
            status: 200,
            headers: { "content-type": "application/json" },
          })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie(), host: "site-a.example", "x-kokoro-namespace": "team_evil" },
      }),
      params(["self", "skills", "pool"]),
    )
    const [, init] = fetchMock.mock.calls[1]!
    expect((init!.headers as Headers).get("x-kokoro-namespace")).toBe("team_1")
  })

  it("returns 401 when there is no envelope", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")
    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", { headers: { host: "site-a.example" } }),
      params(["self", "skills", "pool"]),
    )
    expect(res.status).toBe(401)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("rejects a cross-origin mutation (POST) even with a valid envelope", async () => {
    vi.stubGlobal("fetch", vi.fn())
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const res = await POST(
      new Request("http://localhost/api/hub/self/skills/x/disable", {
        method: "POST",
        headers: { cookie: sessionCookie(), origin: "http://evil.test" },
      }),
      params(["self", "skills", "x", "disable"]),
    )
    expect(res.status).toBe(403)
  })

  it("returns 503 when hub base url is not configured (preview build)", async () => {
    delete process.env.KOKORO_HUB_BASE_URL
    vi.stubGlobal("fetch", vi.fn())
    const { GET } = await import("@/app/api/hub/[...path]/route")
    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", { headers: { cookie: sessionCookie() } }),
      params(["self", "skills", "pool"]),
    )
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe("hub_not_configured")
  })

  it("unknown Host fails closed before refresh and hub upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return new Response("{}", { status: 404 })
      if (url === "http://user.test/auth/refresh") return refreshResponse()
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "unknown.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.status).toBe(404)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=unknown.example",
    ])
  })

  it("cross-Site Host rejects the envelope before refresh and hub upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-b")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-b.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-b.example",
    ])
  })

  it("refresh issuer 返回跨 Site 成功响应时拒绝会话且不触达 hub upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-b")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie("site-a", nowSec() + 60), host: "site-a.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.status).toBe(401)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://user.test/auth/refresh",
    ])
  })

  it("requires a zero-body refresh before a near-expiry upload and never calls Hub", async () => {
    let hubPersisted = false
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-b")
      await new Response(init?.body).arrayBuffer()
      hubPersisted = true
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")

    const request = chunkedPost(
      "http://localhost/api/hub/self/skills/upload/confirm",
      [new Uint8Array([1])],
      {
        cookie: sessionCookie("site-a", nowSec() + 60),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
      },
    )
    const res = await POST(request, params(["self", "skills", "upload", "confirm"]))

    expect(res.status).toBe(428)
    expect(await res.json()).toEqual({
      error: { code: "session_refresh_required", message: expect.any(String) },
    })
    expect(res.headers.get("retry-after")).toBe("1")
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(hubPersisted).toBe(false)
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
    ])
  })

  it("never rotates refresh after an admitted upload crosses the access safety threshold", async () => {
    const startedAtMs = 2_000_000_000_000
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAtMs)
    const startedAtSec = Math.floor(startedAtMs / 1000)
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-b")
      await new Response(init?.body).arrayBuffer()
      clock.mockReturnValue(startedAtMs + 2_000)
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")

    const request = chunkedPost(
      "http://localhost/api/hub/self/skills/upload/confirm",
      [new Uint8Array([1])],
      {
        cookie: sessionCookie("site-a", startedAtSec + 301),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
      },
    )
    const res = await POST(request, params(["self", "skills", "upload", "confirm"]))

    expect(res.status).toBe(200)
    expect(res.headers.get("set-cookie")).toBeNull()
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://hub.test/hub/self/skills/upload/confirm",
    ])
    clock.mockRestore()
  })

  it("rejects a chunked non-upload Hub body after the 256 KiB hard cap", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const request = chunkedPost(
      "http://localhost/api/hub/self/mcp/secrets",
      [new Uint8Array(256 * 1024), new Uint8Array(1)],
      {
        cookie: sessionCookie("site-a", nowSec() + 60),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "application/json",
      },
    )

    const res = await POST(request, params(["self", "mcp", "secrets"]))

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "request_body_too_large" })
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
    ])
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("pre-rejects a declared Hub upload over the downstream 96 MiB HTTP limit", async () => {
    let pulls = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1
        if (pulls >= 100) {
          controller.close()
          return
        }
        controller.enqueue(new Uint8Array([1]))
      },
    })
    const request = new Request("http://localhost/api/hub/self/skills/upload/preview", {
      method: "POST",
      headers: {
        cookie: sessionCookie("site-a", nowSec() + 3600),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
        "content-length": String(96 * 1024 * 1024 + 1),
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" })
    const fetchMock = vi.fn(async (target: string | URL) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")

    const res = await POST(request, params(["self", "skills", "upload", "preview"]))

    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: "request_body_too_large" })
    // Web Streams 可在构造后预拉一个 chunk；Content-Length 守卫不得继续消费请求体。
    expect(pulls).toBeLessThanOrEqual(1)
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(res.headers.get("set-cookie")).toBeNull()
  })

  it("rejects non-POST upload methods before refresh or Hub upstream", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { PUT } = await import("@/app/api/hub/[...path]/route")
    const request = new Request("http://localhost/api/hub/self/skills/upload/preview", {
      method: "PUT",
      headers: {
        cookie: sessionCookie("site-a", nowSec() + 60),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
      },
      body: new Uint8Array([1]),
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    const res = await PUT(request, params(["self", "skills", "upload", "preview"]))

    expect(res.status).toBe(405)
    expect(await res.json()).toEqual({ error: "method_not_allowed" })
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
    ])
  })

  it("streams an admitted upload with duplex half and only succeeds after Hub fully consumes it", async () => {
    const input = [new Uint8Array([0, 255, 1]), new TextEncoder().encode("你好")]
    let fullyConsumed = false
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      expect(init?.body).toBeInstanceOf(ReadableStream)
      expect((init as RequestInit & { duplex?: string }).duplex).toBe("half")
      const received = new Uint8Array(await new Response(init!.body).arrayBuffer())
      fullyConsumed = true
      expect([...received]).toEqual([...input[0]!, ...input[1]!])
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")

    const res = await POST(uploadRequest(input), params(["self", "skills", "upload", "preview"]))

    expect(fullyConsumed).toBe(true)
    expect(res.status).toBe(200)
  })

  it("starts the Hub upload response deadline only after body EOF and releases the lease on 504", async () => {
    process.env.KOKORO_WEB_UPSTREAM_TIMEOUT_MS = "100"
    let fullyConsumed = false
    let upstreamSignal: AbortSignal | null = null
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      if (target.toString().startsWith("http://site.test/")) return siteResponse("site-a")
      await new Response(init?.body).arrayBuffer()
      fullyConsumed = true
      upstreamSignal = init?.signal ?? null
      return new Promise<Response>((_resolve, reject) => {
        upstreamSignal?.addEventListener("abort", () => reject(upstreamSignal?.reason), { once: true })
      })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")

    const response = await POST(
      uploadRequest([new Uint8Array([1, 2, 3])], 3),
      params(["self", "skills", "upload", "preview"]),
    )

    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ error: "upstream_timeout" })
    expect(fullyConsumed).toBe(true)
    expect(upstreamSignal).not.toBeNull()
    expect(upstreamSignal!.aborted).toBe(true)
    const { acquireHubUploadLease } = await import("@/lib/server/http-boundary")
    const afterTimeout = acquireHubUploadLease(new Headers())
    expect(afterTimeout.ok).toBe(true)
    if (afterTimeout.ok) afterTimeout.lease.release()
  })

  it("disposes the request stream when upload admission rejects it", async () => {
    const { acquireHubUploadLease } = await import("@/lib/server/http-boundary")
    const held = acquireHubUploadLease(new Headers())
    expect(held.ok).toBe(true)
    if (!held.ok) return

    const client = new AbortController()
    let sourceCancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        sourceCancelled = true
      },
    })
    const fetchMock = vi.fn(async (target: string | URL) => {
      if (target.toString().startsWith("http://site.test/")) return siteResponse("site-a")
      throw new Error("Hub must not be called after admission rejection")
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const request = new Request("http://localhost/api/hub/self/skills/upload/preview", {
      method: "POST",
      headers: {
        cookie: sessionCookie(),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
        "content-length": "1",
      },
      body,
      duplex: "half",
      signal: client.signal,
    } as RequestInit & { duplex: "half" })

    const response = await POST(request, params(["self", "skills", "upload", "preview"]))
    held.lease.release()
    if (!sourceCancelled) client.abort()

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: "hub_upload_capacity_unavailable" })
    expect(response.headers.get("retry-after")).toBe("2")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(sourceCancelled).toBe(true)
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
    ])
  })

  it("settles and releases admission when Hub rejects before consuming the upload body", async () => {
    const client = new AbortController()
    let sourceCancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        sourceCancelled = true
      },
    })
    let upstreamSignal: AbortSignal | null = null
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      if (target.toString().startsWith("http://site.test/")) return siteResponse("site-a")
      upstreamSignal = init?.signal ?? null
      return new Response("forbidden", { status: 403 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const request = new Request("http://localhost/api/hub/self/skills/upload/confirm", {
      method: "POST",
      headers: {
        cookie: sessionCookie(),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
      },
      body,
      duplex: "half",
      signal: client.signal,
    } as RequestInit & { duplex: "half" })

    const pending = POST(request, params(["self", "skills", "upload", "confirm"]))
    const timeout = Symbol("timeout")
    const outcome = await Promise.race([
      pending,
      new Promise<typeof timeout>((resolve) => setTimeout(() => resolve(timeout), 100)),
    ])
    if (outcome === timeout) {
      client.abort()
    }

    expect(outcome).not.toBe(timeout)
    if (outcome === timeout) return
    expect(outcome.status).toBe(403)
    expect(sourceCancelled).toBe(true)
    expect(upstreamSignal).not.toBeNull()
    expect(upstreamSignal!.aborted).toBe(true)
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://hub.test/hub/self/skills/upload/confirm",
    ])

    const { acquireHubUploadLease } = await import("@/lib/server/http-boundary")
    const afterEarlyResponse = acquireHubUploadLease(new Headers())
    expect(afterEarlyResponse.ok).toBe(true)
    if (afterEarlyResponse.ok) afterEarlyResponse.lease.release()
  })

  it("treats a successful Hub response before upload EOF as a protocol error", async () => {
    let sourceCancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        sourceCancelled = true
      },
    })
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const request = new Request("http://localhost/api/hub/self/skills/upload/preview", {
      method: "POST",
      headers: {
        cookie: sessionCookie(),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    const response = await POST(request, params(["self", "skills", "upload", "preview"]))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "hub_upload_protocol_error" })
    expect(sourceCancelled).toBe(true)
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).toEqual([
      "http://site.test/site-context/resolve?host=site-a.example",
      "http://hub.test/hub/self/skills/upload/preview",
    ])
  })

  it("normalizes an upstream failure before upload EOF and still releases the source", async () => {
    let sourceCancelled = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(64 * 1024))
      },
      cancel() {
        sourceCancelled = true
      },
    })
    const fetchMock = vi.fn(async (target: string | URL) => {
      if (target.toString().startsWith("http://site.test/")) return siteResponse("site-a")
      throw new Error("connection refused")
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const request = new Request("http://localhost/api/hub/self/skills/upload/preview", {
      method: "POST",
      headers: {
        cookie: sessionCookie(),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" })

    const response = await POST(request, params(["self", "skills", "upload", "preview"]))

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: "hub_unreachable" })
    expect(sourceCancelled).toBe(true)
    const { acquireHubUploadLease } = await import("@/lib/server/http-boundary")
    const afterFailure = acquireHubUploadLease(new Headers())
    expect(afterFailure.ok).toBe(true)
    if (afterFailure.ok) afterFailure.lease.release()
  })

  it("conservatively rejects a second direct upload and releases capacity after success", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let hubCalls = 0
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      hubCalls += 1
      await new Response(init!.body).arrayBuffer()
      if (hubCalls === 1) await gate
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const path = params(["self", "skills", "upload", "preview"])

    const first = POST(uploadRequest([new Uint8Array([1])], 1), path)
    await vi.waitFor(() => expect(hubCalls).toBe(1))
    const rejected = await POST(uploadRequest([new Uint8Array([2])], 1), path)

    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toEqual({ error: "hub_upload_capacity_unavailable" })
    expect(rejected.headers.get("retry-after")).toBe("2")
    release()
    await first
    const afterRelease = await POST(uploadRequest([new Uint8Array([3])], 1), path)
    expect(afterRelease.status).toBe(200)
  })

  it("returns stable 503 when aggregate upload reservation is exhausted and releases on upstream error", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let hubCalls = 0
    let failNext = false
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      hubCalls += 1
      await new Response(init!.body).arrayBuffer()
      if (failNext) throw new Error("hub unavailable")
      if (hubCalls === 1) await gate
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const path = params(["self", "skills", "upload", "preview"])

    const first = POST(uploadRequest([new Uint8Array([1])], 96 * 1024 * 1024), path)
    await vi.waitFor(() => expect(hubCalls).toBe(1))
    const rejected = await POST(uploadRequest([new Uint8Array([2])], 64 * 1024 * 1024), path)
    expect(rejected.status).toBe(503)
    expect(await rejected.json()).toEqual({ error: "hub_upload_capacity_unavailable" })
    expect(rejected.headers.get("retry-after")).toBe("2")

    release()
    await first
    failNext = true
    const failed = await POST(uploadRequest([new Uint8Array([3])], 1), path)
    expect(failed.status).toBe(502)
    failNext = false
    const afterError = await POST(uploadRequest([new Uint8Array([4])], 1), path)
    expect(afterError.status).toBe(200)
  })

  it("propagates client abort to the upload upstream, skips refresh, and releases the lease", async () => {
    const client = new AbortController()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1]))
      },
    })
    const abortedRequest = new Request("http://localhost/api/hub/self/skills/upload/preview", {
      method: "POST",
      headers: {
        cookie: sessionCookie("site-a", nowSec() + 3600),
        host: "site-a.example",
        origin: "http://site-a.example",
        "content-type": "multipart/form-data; boundary=test",
      },
      body: source,
      duplex: "half",
      signal: client.signal,
    } as RequestInit & { duplex: "half" })
    const signalRef: { current: AbortSignal | null } = { current: null }
    const fetchMock = vi.fn(async (target: string | URL, init?: RequestInit) => {
      const url = target.toString()
      if (url.startsWith("http://site.test/")) return siteResponse("site-a")
      if (url === "http://user.test/auth/refresh") return refreshResponse("site-a")
      signalRef.current = init?.signal ?? null
      await new Response(init!.body).arrayBuffer()
      return new Response("{}", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/hub/[...path]/route")
    const path = params(["self", "skills", "upload", "preview"])

    const pending = POST(abortedRequest, path)
    await vi.waitFor(() => expect(signalRef.current).not.toBeNull())
    client.abort()
    const aborted = await pending

    expect(aborted.status).toBe(400)
    expect(signalRef.current).not.toBeNull()
    expect(signalRef.current!.aborted).toBe(true)
    expect(fetchMock.mock.calls.map(([target]) => target.toString())).not.toContain(
      "http://user.test/auth/refresh",
    )
    const afterAbort = await POST(uploadRequest([new Uint8Array([2])], 1), path)
    expect(afterAbort.status).toBe(200)
  })

  it("does not forward upstream Set-Cookie or Location headers", async () => {
    const fetchMock = vi.fn(async (target: string | URL) =>
      target.toString().startsWith("http://site.test/")
        ? siteResponse("site-a")
        : new Response("{}", {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": "attacker=1",
              location: "https://attacker.example",
            },
          }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const { GET } = await import("@/app/api/hub/[...path]/route")

    const res = await GET(
      new Request("http://localhost/api/hub/self/skills/pool", {
        headers: { cookie: sessionCookie(), host: "site-a.example" },
      }),
      params(["self", "skills", "pool"]),
    )

    expect(res.headers.get("set-cookie")).toBeNull()
    expect(res.headers.get("location")).toBeNull()
  })
})
