// 登出（BFF）：清信封 cookie（Max-Age=0）+ best-effort 吊销服务端 refresh。
// 断言：跨源拒；有信封 → 调 user /auth/refresh/revoke 带信封里的 refresh_token；
// 无信封 → 不触达 user 仍清 cookie；user 不可达 → 不阻塞登出（仍 200 + 清 cookie）。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { sealEnvelope } from "@/lib/server/session-envelope"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
  KOKORO_INTERNAL_SECRET_WEB_BFF: "svc-secret",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function sessionCookie(): string {
  const sealed = sealEnvelope(
    { runtime_jwt: "rt.jwt.sig", access_exp: nowSec() + 3600, refresh_token: "rt-to-revoke", user_id: "u1", namespace: "team_1", site_id: "site-a", exp: nowSec() + 2_592_000 },
    [ENV.KOKORO_WEB_SESSION_SECRET],
  )
  return `kokoro_session=${sealed}`
}

function clearsCookie(res: Response): boolean {
  const setCookie = res.headers.get("set-cookie") ?? ""
  return setCookie.includes("kokoro_session=") && /max-age=0/i.test(setCookie)
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe("POST /api/auth/logout", () => {
  it("revokes the envelope's refresh at user, then clears the cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/auth/logout/route")

    const res = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: sessionCookie(), origin: "http://localhost", host: "localhost" },
      }),
    )
    expect(res.status).toBe(200)
    expect(clearsCookie(res)).toBe(true)

    // 吊销带信封里的 refresh_token + web-bff 凭据（浏览器无从提供）。
    const [target, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(target.toString()).toBe("http://user.test/auth/refresh/revoke")
    expect(JSON.parse(init.body as string)).toEqual({ refresh_token: "rt-to-revoke" })
    expect((init.headers as Record<string, string>)["x-kokoro-service"]).toBe("web-bff")
  })

  it("rejects a cross-origin logout (403), does not touch user", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/auth/logout/route")
    const res = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: sessionCookie(), origin: "http://evil.test", host: "localhost" },
      }),
    )
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("no envelope → clears cookie without touching user", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const { POST } = await import("@/app/api/auth/logout/route")
    const res = await POST(
      new Request("http://localhost/api/auth/logout", { method: "POST", headers: { origin: "http://localhost", host: "localhost" } }),
    )
    expect(res.status).toBe(200)
    expect(clearsCookie(res)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("user unreachable → still logs out (200 + cookie cleared, revoke is best-effort)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))
    const { POST } = await import("@/app/api/auth/logout/route")
    const res = await POST(
      new Request("http://localhost/api/auth/logout", {
        method: "POST",
        headers: { cookie: sessionCookie(), origin: "http://localhost", host: "localhost" },
      }),
    )
    expect(res.status).toBe(200)
    expect(clearsCookie(res)).toBe(true)
  })
})
