// session 客户端 base：同源 BFF 代理前缀（AUTH-P0）。浏览器不再直连 kokoro-session，
// 真实地址留在服务端 `/api/session` 代理里；鉴权由 httpOnly 信封 cookie 同源自动携带，
// 前端不持 bearer。相对前缀经 client 的 baseUrl+path 拼接消费（非 new URL）。
export const SESSION_PROXY_BASE = "/api/session"

export function sessionBaseUrl(): string {
  return SESSION_PROXY_BASE
}
