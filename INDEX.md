---
architectureIndex: 1
rootId: service.web
owners:
  - "@LordFoxFairy"
---

# kokoro-web（pnpm monorepo）

## Responsibilities

Own the Site application factory, brand-neutral product packages, a reference fixture, and the independently deployed Admin console.

正式工作区成员：

```
apps/
  admin/          @kokoro/admin-web      运营后台，独立部署的 RBAC 特权面。
  reference-site/ @kokoro/reference-site Site factory 的非生产资格夹具。
packages/
  site-scaffold/ @kokoro/site-scaffold 为每个 Site 生成独立项目、artifact 与 CI。
  site-bff/      @kokoro/site-bff      Site server-only 组合根。
  chat-app/      @kokoro/chat-app      brand-neutral Chat 产品。
  account-app/   @kokoro/account-app   brand-neutral Account 产品。
  media-app/     @kokoro/media-app     每个独立 Site 的 brand-neutral Studio/Library 产品工厂。
  memory-app/    @kokoro/memory-app    每个独立 Site 可选装的 saved-memory 设置、历史、恢复和数据权利产品面。
  tsconfig/ @kokoro/tsconfig   共享 TS 基线 base.json（app 各自 extends，只留 app 专属）。
  i18n/     @kokoro/i18n       framework-agnostic i18n 引擎（createI18n：negotiate/translate/interpolate）。见其 INDEX。
  session-client/              Root contract-bound Session HTTP/SSE client；只收 path transport，不收 URL/凭据/Site。
  chat-surface/                browser-safe Chat projection + assistant-ui adapter；Session 仍是持久化与终态真源。
  bff-runtime/                 server-only Site bootstrap、SessionAccessGrant 与 fail-closed proxy trust kernel。
```

正式 Next.js surfaces 锁在 Next 16.2.12 / React 19.2.8。根仓不提供默认 `dev`/`start`；
`build:site` 验证 Site factory、共享依赖与 reference fixture，`build:admin` 独立验证 Admin。
仓根 `deployables.yaml` 是 Web-owned 发布库存：`admin-web` 绑定独立 standalone Dockerfile、
digest-only 发布、非特权只读运行和依赖感知 readiness；未绑定精确 Site release 时
`independent-site-release` 保持 blocked，reference fixture 永不替代生产 Site 制品。

### Fixed core Site release

`pnpm run release:core-site -- --definition ABS --contract-keyring ABS --image REGISTRY/REPO:TAG --platform linux/amd64 --report ABS --docker-config ABS --push`
保持原有远端发布；固定单机本地构建把末尾替换为 `--load`。
在 OS 临时目录中生成一个固定的单 Site 工件：只保留登录、Account/兑换、Chat、Session proxy 和 health
路由；公共注册与邮件验证、Media、Memory、Payment 与附件 UI 均为关闭状态。Core 工件物理不包含
`/register`、`/verify-email` 或登录页注册链接，并将同一静态 closed operation allowlist 传给 Site BFF，
所以直接构造 acquisition 请求也会在 Platform transport 之前失败。登录、MFA、安全会话和卡密兑换保留。
`--push` 保持原有 registry 发布路径；`--load` 用于固定单机的本地镜像库，只做单平台 Buildx load，并使用同仓库
临时 tag。两条路径都读取 Buildx `containerimage.digest`；本地路径还必须从 `docker image inspect` 得到唯一匹配的
`RepoDigest`，两者完全一致后才原子写入 `0600` 报告。报告只保存
`registry/repository@sha256:<64-hex>`。生成 Site 的
`KOKORO_WEB_ARTIFACT_DIGEST` 由部署环境设置为最终 OCI manifest digest（不使用 mutable tag）。定义包含稳定
`siteId`，但不接受操作员提供的 package archive；builder 只从 HEAD 的 tracked-clean `git archive` 在临时目录
offline/frozen 安装、构建 scaffold 并打包固定 11-package closure。核心 Site 另暴露静态
`/api/release/metadata` 作为 fixed_http bootstrap identity，返回严格七字段 release metadata；它不替代
`/api/health/ready` 的依赖就绪检查。

报告中的 `finalSourceClosureSha256` 只表示最终裁剪前输入定义与固定 package closure 的 canonical
source digest；运行时 `webArtifactDigest` 才是 Buildx 返回的 OCI manifest digest。子进程使用显式环境
allowlist，并以空 npm user/global config 隔离宿主配置；registry 只通过必填的绝对 `--docker-config`
及其中配置的 credential helper 取凭据。

该离线构建与推送不改变库存 readiness；在真实推送镜像和 latest-head E2E 资格证据完成前，
`independent-site-release` 仍保持 `blocked`。

## Non-responsibilities

Web does not execute Agent graphs, own Session/Platform business persistence, or share credentials/databases across service boundaries.

## Public boundary

每个生产 Site 是 `@kokoro/site-scaffold` 生成的独立外部项目；`apps/admin` 是特权运营面；`packages/*`
是 Web 仓发布的稳定构件。`apps/reference-site` 只验证 factory composition，不是共享用户站部署单元。

**Site 与 Admin 信任边界不可混**：每个 Site 的同源 BFF 密封 cookie/credential，浏览器只见 HTTP/SSE；Admin
使用加密的 server-only authority session，并通过 Platform-owned OIDC 与本仓生成镜像调用 Platform 私有 Connect 控制面。

## Callers and dependencies

Browsers call each app. User BFF calls Session HTTP/SSE; Admin server code calls Platform generated Connect services.

- `packages/session-client/src/generated/*` 是新 Site Chat 的 Root 生成镜像；`packages/chat-surface` 只经该包消费
  Session 契约，不跨仓导入 Session 源码。Session browser v3 的完整 snapshot、opaque cursor、commands 与 SSE
  schemas 已生成并由 client/BFF adapter 消费；browser 不接触 Session URL、Site 或授权材料。
- `packages/bff-runtime` 是 brandless server-only trust kernel。它按 Root 的 ProductContext→PersonalContext→
  SessionAccessGrant 三段权威面组合 bootstrap；Session browser v3 adapter 只从生成 registry 构造相对路径和 schema，
  禁止手写 URL、浏览器提供 Site/凭据或重复 wire contract。
- `apps/admin` 上游是 `kokoro-platform`。`apps/admin/lib/generated/{admin-identity,admin-query-v2,admin-commerce,admin-credit,site-provisioning,model-control}/**`
  是根仓生成的官方 consumer mirrors，必须提交且禁止手改；已退役的 `apps/admin/lib/generated/contracts/**`
  Admin Auth mirror 不是当前运行时边界，不得为兼容检查恢复。

## Data ownership and events

Web owns cookies, rendering state, drafts, and client caches. Session owns conversations/events and Platform owns identity/commercial/admin facts.

## Runtime and security

Server-only credentials stay outside browser bundles; every non-explicit-development host fails closed to bounded trusted Site resolution, and Admin has no Platform database credential. Admin removes browser-spoofable internal headers before server injection and its filtered BFFs enforce bounded, positive-schema JSON responses.
Admin runtime 只依赖本仓 generated mirror，不允许 sibling repository source import。

`test/fixtures/web-chat-credit-runtime.mjs` 是 Root 兼容性场景唯一的 Web-owned child entry。它通过
`@kokoro/site-scaffold` 公开 export 构建独立 Site candidate，以 `setup -> serve -> exercise -> observe`
闭合生成 CA、standalone + strict-Host HTTPS、NextAuth cookie jar、Account before/after、Session client/SSE terminal
和 logical replay，并由固定版本真实 Chromium 在生成 Site `/account` 完成卡密 preview、一次 confirm 和同 flow 的
UI recover，随后验证 Credit/Product readback。Chromium 只信任生成 leaf 的 SPKI pin，使用一次性 profile；raw Code
只从精确 `0600` 私有文件进入瞬时表单与唯一 preview 请求，不进入 state、URL、日志、浏览器 storage/profile 或
evidence。`exercise` 只落 journey evidence，`serve` 完全退出并写 lifecycle evidence 后 `observe` 才组合最终结果。
Auth、Platform/Session upstream 或 mTLS 材料不完整时保持 fail-closed；最终 observation
只含固定 owner-safe 计数/布尔值，不返回内容、金额、credential 或 Usage/Gateway 内部引用。该入口不导入或
启动 `apps/reference-site`，也不增加 route、RPC、protocol、worker 或运维面。

## Idempotency, failure, and recovery

Client commands carry stable identity; reconnect uses Session snapshots/cursors; Admin effects reconcile durable receipts after ambiguous timeouts.

## Extension rules and forbidden dependencies

Put app-specific behavior in its app and truly shared Web code in `packages/*`. Never import sibling repository source or combine user/admin trust boundaries.

- 两 app 都用的东西 → 抽 `packages/*`；app 专属（页面、业务组件、各自消息字典）留 `apps/*`。
- 新增共享包：`packages/<name>/package.json` 命名 `@kokoro/<name>`，app 以 `workspace:*` 依赖。
- 子仓各自独立锁定工具链：Session/Platform 拥有自己的 TypeScript、Vitest、Node types、包管理器与 lockfile。
  本仓只改自己的 `pnpm-lock.yaml`，不修改或合并兄弟仓依赖。

## Current gotchas

- **Acquisition shutdown**：User Web 保留固定 Site 的只读套餐/credit/account 展示与 Platform Public 合同绑定的卡密 preview→confirm→recover；checkout/mock-pay/refund BFF、购买 CTA、provider secret/SDK 仍禁止。User 兑换卡密只走 server-only generated client，raw Code 不落持久状态或日志。仓库门禁对两 app 的完整 API route inventory、Admin rewrite 清单、proxy egress 和 plans GET-only export 采用闭合 allowlist。Admin 的 generic manifests/resource/action/OpenAPI、billing overview、User360 与 payment module/metrics/orders/action 对浏览器恒不可达；下面的 typed AdminCommerce 管理面不是 User acquisition/payment 入口。
- **AdminCommerce hard cut**：Admin 现有五个 Site-scoped Refine 资源与 canonical 20-RPC generated
  `AdminCommerceService` 对齐。BFF 只有逐资源 list/get/publish/issue 与逐状态 transition route，禁止通用
  view/action proxy。首次 Issue raw codes 只存在于组件局部的一次性 Blob 导出流程；replay 只引导 abandon
  并用新 batch/new command reissue。此管理面不恢复 User checkout/payment acquisition。
- **每 Site 一个独立 Web 项目**：Site factory 输出独立产品名、repository、artifact、release、cookie/account
  边界与 rollback 权；仓内不存在共享用户站 runtime，reference fixture 也不可作为生产部署入口。
- **`.npmrc` 使用 `node-linker=isolated`**（非 hoisted），防止 app/private package 依赖被根级幽灵依赖掩盖。切换
  linker 属根工具链迁移，必须以 clean install、两 app build/test 与 dependency-boundary evidence 证明，不能直接改。
- **i18n 分层**：解析引擎单一实现在 `@kokoro/i18n`；Admin 持有自己的消息字典与 React 绑定，
  独立 Site 的品牌与产品 copy 通过生成项目和 brand-neutral packages 注入。
- **dev 起环**：仓根没有默认 `dev`/`start`，避免把 reference fixture 误部署。只允许显式
  `pnpm run dev:reference` 做编译夹具调试；真实 Site 必须在自己的项目中启动，Admin 独立启动。

## Verification

Run `pnpm -r lint`, `pnpm -r typecheck`, `pnpm test`, `pnpm run build:site`, and `pnpm run build:admin`.
Admin production CI additionally runs `docker build --file apps/admin/Dockerfile .` and promotes only
the resulting registry digest.
CI 另跑 `pnpm audit --prod --audit-level high`；外部 Site 项目还必须执行模板内自己的 CI/artifact verification。
Web Chat/Credit runtime cut 使用 `pnpm exec node --test test/runtime/web-chat-credit-runtime.test.mjs`。
