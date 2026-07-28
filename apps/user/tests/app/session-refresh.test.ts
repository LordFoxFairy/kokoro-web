// 静默续期核心逻辑测试:resolveSessionWithRefresh 的四态——access 尚新不续 / 快过期续成功 /
// 续失败用旧不踢 / 无信封。fetch(/auth/refresh) 全 mock,不打网络。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { authConfig, resolveSessionWithRefresh } from "@/lib/server/auth"
import { sealEnvelope, type EnvelopePayload } from "@/lib/server/session-envelope"

const ENV = {
  KOKORO_WEB_SESSION_SECRET: "test-session-secret",
  KOKORO_USER_BASE_URL: "http://user.test",
  KOKORO_SESSION_BASE_URL: "http://session.test",
  KOKORO_SITE_ID: "site-a",
}

const nowSec = (): number => Math.floor(Date.now() / 1000)

function reqWith(payload: EnvelopePayload): Request {
  const sealed = sealEnvelope(payload, [ENV.KOKORO_WEB_SESSION_SECRET])
  return new Request("http://localhost/api/session/x", { headers: { cookie: `kokoro_session=${sealed}` } })
}

// 造一个 decodeJwtExp 能解的 base64url JWT（header.payload.sig，payload 含 exp）。
function jwtWithExp(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")
  const payload = Buffer.from(JSON.stringify({ exp })).toString("base64url")
  return `${header}.${payload}.sig`
}

function base(): EnvelopePayload {
  return {
    runtime_jwt: "old-rt",
    access_exp: nowSec() + 60,
    refresh_token: "r1",
    user_id: "u1",
    namespace: "team_1",
    site_id: "site-a",
    exp: nowSec() + 2_592_000,
  }
}

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of Object.keys(ENV)) delete process.env[k]
})

describe("resolveSessionWithRefresh", () => {
  it("access 尚新（剩余 ≥ 阈值）→ 不续期、不 set-cookie、不打 /auth/refresh", async () => {
    const config = authConfig()!
    const req = reqWith({ ...base(), access_exp: nowSec() + 3600 })
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)
    const resolved = await resolveSessionWithRefresh(req, config, "site-a")
    expect(resolved).not.toBeNull()
    expect(resolved!.setCookie).toBeNull()
    expect(resolved!.envelope.runtime_jwt).toBe("old-rt")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("access 快过期 + 续期成功 → 换新 access + 轮换 refresh + 重密封 set-cookie", async () => {
    const config = authConfig()!
    const req = reqWith(base())
    const newJwt = jwtWithExp(nowSec() + 3600)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              token: newJwt,
              namespace: "team_1",
              site_id: "site-a",
              refresh_token: "r2",
              refresh_expires_at: new Date((nowSec() + 2_592_000) * 1000).toISOString(),
            },
          }),
          { status: 200 },
        ),
      ),
    )
    const resolved = await resolveSessionWithRefresh(req, config, "site-a")
    expect(resolved!.envelope.runtime_jwt).toBe(newJwt)
    expect(resolved!.envelope.refresh_token).toBe("r2")
    expect(resolved!.setCookie).toContain("kokoro_session=")
    expect(resolved!.setCookie).toContain("HttpOnly")
  })

  it("access 快过期 + 续期失败（并发/无效 → 401）→ 用旧信封、不 set-cookie（不误踢）", async () => {
    const config = authConfig()!
    const req = reqWith(base())
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })))
    const resolved = await resolveSessionWithRefresh(req, config, "site-a")
    expect(resolved!.envelope.runtime_jwt).toBe("old-rt")
    expect(resolved!.setCookie).toBeNull()
  })

  it("续期响应试图切换 Site → 保留原信封且绝不 set-cookie", async () => {
    const config = authConfig()!
    const original = base()
    const req = reqWith(original)
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            data: {
              token: jwtWithExp(nowSec() + 3600),
              namespace: "team_other",
              site_id: "site-b",
              refresh_token: "r-cross-site",
              refresh_expires_at: new Date((nowSec() + 2_592_000) * 1000).toISOString(),
            },
          }),
          { status: 200 },
        ),
      ),
    )

    const resolved = await resolveSessionWithRefresh(req, config, "site-a")
    expect(resolved?.envelope).toEqual(original)
    expect(resolved?.setCookie).toBeNull()
  })

  it("信封 Site 与 Host 权威 Site 不同 → 在 refresh issuer 前拒绝", async () => {
    const config = authConfig()!
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const resolved = await resolveSessionWithRefresh(
      reqWith({ ...base(), site_id: "site-b" }),
      config,
      "site-a",
    )

    expect(resolved).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("无信封 → null（未认证）", async () => {
    const config = authConfig()!
    const req = new Request("http://localhost/api/session/x")
    const resolved = await resolveSessionWithRefresh(req, config, "site-a")
    expect(resolved).toBeNull()
  })
})
