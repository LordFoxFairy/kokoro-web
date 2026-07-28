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
  - `envelopePayloadSchema` / `EnvelopePayload`：`{runtime_jwt,access_exp,refresh_token,user_id,namespace,site_id,exp}`。
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
  - `preflightSession(request, config, expectedSiteId)`：只解封并校验 Host 权威 Site，不产生网络请求或
    cookie 副作用。protected BFF 必须先做这个纯 preflight，再完成本地 body admission，最后才允许 refresh。
  - `hasSufficientAccessWindow(accessExp, nowSec, minimum?)`：纯 access 窗口判定；effectful streaming 路径
    必须在打开下游前调用，不得在已开始的副作后 inline rotate refresh。
  - `resolveSessionWithRefresh(request, config, expectedSiteId, preflightEnvelope?)`：Site-scoped 代理会话入口；
    信封 Site 必须等于当前 Host 权威 Site，且在调用 refresh issuer 前拒绝跨 Site 信封；续期响应也必须
    保持该 Site，否则按安全违规拒绝整个会话（只有普通续期失败才允许回退仍有效的旧 access）。传入
    preflight 结果时仍会重验 Site，但不会重复解密 cookie。
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
- `http-boundary.ts`（浏览器/内部 HTTP 内存边界）
  - `readBoundedRequestBody` / `readBoundedRequestJson`：先按可信度最低的 `Content-Length` 预拒，
    再对 chunked 实读计数；超限取消流并返回稳定 413，不调用业务上游。
  - `readBoundedResponseJson`：仅供必须解析的 Site/Auth/Payment 小响应；代理的 SSE、文件和普通响应
    不解析，保持白名单响应头 + stream pass-through。
  - `prepareCountedRequestBody`：Hub skill upload 专用的 counted stream；以 `TransformStream` 背压转发，
    不把上传聚合进 Web 内存；声明长度与实读长度都受 96 MiB 限制。其幂等 `dispose()`
    同时中止 source/transform/upstream 所有权边，无消费者的提前响应也不得卡死 completion。
  - `acquireHubUploadLease`：进程内准入门；直接上传不信任 `Content-Length`，每个均保守预留
    96 MiB，在 128 MiB aggregate 限制下第二个直传稳定返回
    `503 hub_upload_capacity_unavailable + Retry-After`。租约 release 幂等，在成功、错误、早响应、
    客户端中止所有终态释放；更小预留只能由后续可信 staging receipt 引入。
  - 缓冲请求 cap：Auth 16 KiB、Team 64 KiB、Session 1 MiB、Hub 普通 256 KiB；Hub skill upload
    是 96 MiB **流式计数上限**，精确对齐 Hub `UPLOAD_BODY_LIMIT`（zip 文件本身仍由 Hub 限制为 64 MiB）。
  - 解析响应 cap：Site 64 KiB、Auth 256 KiB、Payment 套餐目录 1 MiB。

## 关键协作者

- 上游：`src/app/api/auth/*`（request/callback/logout/session-state）、`src/app/api/team/switch`、
  `src/app/page.tsx`（rail 品牌注入）、`src/app/api/session/[...path]`、`src/app/api/hub/[...path]`、
  `src/app/api/team/[...path]`（三类 protected BFF 都先解析 Host Site，再续期/代理）。
- 下游：kokoro-user（`/auth/magic-links`、`/auth/magic-links/consume`）、kokoro-session（代理目标）、
  kokoro-site（`/site-context/resolve`，出站 `x-kokoro-service: web-bff`；`KOKORO_SITE_BASE_URL`）。

## 运行时约束

- 路由 `export const runtime = "nodejs"`（node:crypto + 流式代理）。
- 信封 `access_exp` 对齐 runtime JWT；信封 `exp` 与 cookie Max-Age 对齐 refresh 寿命。
- nonce 一次性：申请设 cookie，回调用毕即清；跨设备无 nonce → 统一 link_unavailable。
- 原文 magic-link token / nonce 原文绝不落日志。
- protected BFF 对未知 Host 返回中性 `site_unresolved`，对跨 Site 信封按未认证处理；两者均不得 refresh、
  写 cookie 或触达业务上游。
- Session/Team/Hub 普通写请求的顺序固定为 Host→Site → 纯 session preflight → body 校验/准入 → refresh
  → 上游；本地 malformed/oversize/read-abort 不得消耗 refresh rotation、写 cookie 或调用业务上游。
- Hub upload 因下游必须消费 multipart 才能形成背压，只允许 access 剩余窗口足够的信封打开流；
  临界/过期返回 `428 session_refresh_required`，浏览器先调用 Host/Site-bound 零 body
  `/api/auth/session-state` 刷新 cookie，再最多重试一次。upload 本身永不 inline refresh；任何超限/读取错误/
  客户端中止/上游提前响应都必须中止整条流。Hub 的持久化不变量仍是“完整读取 multipart 后才持久化”；
  跨进程 staging receipt 属于后续 W3。

## 扩展规则

- 新增受信入站数据先过 zod；宽类型不出边界层。
- 轮换密钥：`KOKORO_WEB_SESSION_SECRET` 逗号追加新钥到**队首**，旧钥保留一个轮换窗口再删。
