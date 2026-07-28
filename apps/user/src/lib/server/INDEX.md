---
architectureIndex: 1
rootId: web.user.server
owners:
  - "@LordFoxFairy"
---

# lib/server — BFF 鉴权边界（服务端专用）

## 职责

把 kokoro-user 签发结果密封进 httpOnly cookie，浏览器只见同源路由；session 代理注入 Bearer。
浏览器 JS 读不到信封、不持 token。**勿从 client 组件 import 本目录**（含 node:crypto 与服务端配置）。

## 公开 API

- `session-envelope.ts`（framework-free，纯 node:crypto + zod，可独立单测）
  - `sealEnvelope(payload, secrets)`：AES-256-GCM 密封，secrets[0]=current；三段 base64url `iv.ct.tag`。
  - `openEnvelope(token, secrets, nowSec)`：解封+验 exp；结构错/篡改/过期/全钥失败 → null。依次尝试
    全部 secrets = 双钥轮换（旧信封在窗口内仍可解）。
  - `envelopePayloadSchema` / `EnvelopePayload`：`{runtime_jwt,user_id,namespace,site_id,exp}`。
  - `safeEqual(a,b)`：常量时间比对。
- `auth.ts`（Next 感知装配）
  - `authConfig(env?)`：四项 env（`KOKORO_WEB_SESSION_SECRET` 逗号分隔 / `KOKORO_USER_BASE_URL` /
    `KOKORO_SESSION_BASE_URL` / `KOKORO_SITE_ID`）齐备才返配置，缺任一 → null（预览档）。
  - cookie：`SESSION_COOKIE`/`NONCE_COOKIE` 名，`sessionCookieOptions`/`nonceCookieOptions`
    （httpOnly+SameSite=Lax+prod Secure），`readCookie`/`readEnvelope`。
  - nonce：`newNonce`/`hashNonce`（sha256 hex）；`decodeJwtExp`（仅解不验签）。
  - 出站：`callerHeaders`（`x-kokoro-service: web-bff` + 可选内部凭据），`userRequestMagicLink`/
    `userConsumeMagicLink`（对 user 的 magic-link 调用，失败归一）。
  - `sameOriginOk`：变更类请求同源守卫（Origin 存在且 host 不符则拒）。
  - magic-link consume 与 team-session issue 请求都携 Host 解析出的 `site_id`；权威响应也必须返回相同
    `site_id` 才能密封。refresh 响应不得改变原信封 Site。
- `site.ts`（host→site 解析，SITE-REAL）
  - `resolveSite(host, env?) → ResolvedSite | null`：Host 经 kokoro-site `/site-context/resolve` 定
    `{siteId, brand}`；**仅成功解析**按 host 短 TTL（30s）缓存（失败/未命中不写缓存，服务抖动即时恢复）。
    只有 `NODE_ENV=development` 且 `KOKORO_SITE_ALLOW_DEV_FALLBACK=true` 才可退回 env 缺省站点；
    test/未知环境/staging/production 以及显式 strict 均 fail-closed。resolver 使用内置有界超时
    `KOKORO_SITE_RESOLVE_TIMEOUT_MS`（默认 1500ms，钳制 100..5000ms），超时会中止请求并回 `null`。
  - `resolveSiteId(host, fallbackSiteId)`：仅取 site_id 供 auth 流（magic-link/callback/team-switch）
    与 Site-scoped BFF；仅显式 development fallback 允许 `fallbackSiteId`，其余环境保持 `null`，禁止未知 Host
    签发/换签信封或触达业务上游。
  - `SiteBrand`/`ResolvedSite`/`DEFAULT_BRAND`；`__clearSiteResolveCache()` 仅测试用。

## 关键协作者

- 上游：`src/app/api/auth/*`（request/callback/logout/session-state）、`src/app/api/team/switch`、
  `src/app/page.tsx`（rail 品牌注入）、`src/app/api/session/[...path]`（代理）、`src/app/api/hub/[...path]`（骨架）。
- 下游：kokoro-user（`/auth/magic-links`、`/auth/magic-links/consume`）、kokoro-session（代理目标）、
  kokoro-site（`/site-context/resolve`，出站 `x-kokoro-service: web-bff`；`KOKORO_SITE_BASE_URL`）。

## 运行时约束

- 路由 `export const runtime = "nodejs"`（node:crypto + 流式代理）。
- 信封 exp 对齐 runtime_jwt exp，cookie Max-Age 据此设定。
- nonce 一次性：申请设 cookie，回调用毕即清；跨设备无 nonce → 统一 link_unavailable。
- 原文 magic-link token / nonce 原文绝不落日志。

## 扩展规则

- 新增受信入站数据先过 zod；宽类型不出边界层。
- 轮换密钥：`KOKORO_WEB_SESSION_SECRET` 逗号追加新钥到**队首**，旧钥保留一个轮换窗口再删。
