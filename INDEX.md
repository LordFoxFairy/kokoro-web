---
architectureIndex: 1
rootId: service.web
owners:
  - "@LordFoxFairy"
---

# kokoro-web（pnpm monorepo）

## Responsibilities

Own the Site application factory, brand-neutral product packages, a reference fixture, and the independently deployed Admin console.

正式工作区成员（`apps/user` 已退出 workspace，不参与安装、构建、测试或发布）：

```
apps/
  admin/          @kokoro/admin-web      运营后台，独立部署的 RBAC 特权面。
  reference-site/ @kokoro/reference-site Site factory 的非生产资格夹具。
packages/
  site-scaffold/ @kokoro/site-scaffold 为每个 Site 生成独立项目、artifact 与 CI。
  site-bff/      @kokoro/site-bff      Site server-only 组合根。
  chat-app/      @kokoro/chat-app      brand-neutral Chat 产品。
  account-app/   @kokoro/account-app   brand-neutral Account 产品。
  tsconfig/ @kokoro/tsconfig   共享 TS 基线 base.json（app 各自 extends，只留 app 专属）。
  i18n/     @kokoro/i18n       framework-agnostic i18n 引擎（createI18n：negotiate/translate/interpolate）。见其 INDEX。
  session-client/              Root contract-bound Session HTTP/SSE client；只收 path transport，不收 URL/凭据/Site。
  chat-surface/                browser-safe Chat projection + assistant-ui adapter；Session 仍是持久化与终态真源。
  bff-runtime/                 server-only Site bootstrap、SessionAccessGrant 与 fail-closed proxy trust kernel。
```

正式 Next.js surfaces 锁在 Next 16.2.12 / React 19.2.8。根 `dev`/`start` 只启动 reference fixture；
`build:site` 验证 Site factory、共享依赖与 reference fixture，`build:admin` 独立验证 Admin。

## Non-responsibilities

Web does not execute Agent graphs, own Session/Platform business persistence, or share credentials/databases across service boundaries.

## Public boundary

每个生产 Site 是 `@kokoro/site-scaffold` 生成的独立外部项目；`apps/admin` 是特权运营面；`packages/*`
是 Web 仓发布的稳定构件。`apps/reference-site` 只验证 factory composition，不是共享用户站部署单元。

**Site 与 Admin 信任边界不可混**：每个 Site 的同源 BFF 密封 cookie/credential，浏览器只见 HTTP/SSE；Admin
使用 NextAuth，并通过本仓生成镜像调用 Platform Admin 私有 Connect 控制面。

## Callers and dependencies

Browsers call each app. User BFF calls Session HTTP/SSE; Admin server code calls Platform generated Connect services.

- `packages/session-client/src/generated/*` 是新 Site Chat 的 Root 生成镜像；`packages/chat-surface` 只经该包消费
  Session 契约，不跨仓导入 Session 源码。Session browser v3 的完整 snapshot、opaque cursor、commands 与 SSE
  schemas 已生成并由 client/BFF adapter 消费；browser 不接触 Session URL、Site 或授权材料。
- `packages/bff-runtime` 是 brandless server-only trust kernel。它按 Root 的 ProductContext→PersonalContext→
  SessionAccessGrant 三段权威面组合 bootstrap；Session browser v3 adapter 只从生成 registry 构造相对路径和 schema，
  禁止手写 URL、浏览器提供 Site/凭据或重复 wire contract。
- `apps/admin` 上游 `kokoro-platform`（platform-admin 网关）：`apps/admin/lib/generated/contracts/**` 是根仓 Buf
  契约的生成镜像，必须提交且禁止手改；当前仅覆盖 `kokoro/platform/admin/v1` admin-auth，其余跨仓调用不走此路径。

## Data ownership and events

Web owns cookies, rendering state, drafts, and client caches. Session owns conversations/events and Platform owns identity/commercial/admin facts.

## Runtime and security

Server-only credentials stay outside browser bundles; every non-explicit-development host fails closed to bounded trusted Site resolution, and Admin has no Platform database credential. Admin removes browser-spoofable internal headers before server injection and its filtered BFFs enforce bounded, positive-schema JSON responses.
Admin runtime 只依赖本仓 generated mirror，不允许 sibling repository source import。

## Idempotency, failure, and recovery

Client commands carry stable identity; reconnect uses Session snapshots/cursors; Admin effects reconcile durable receipts after ambiguous timeouts.

## Extension rules and forbidden dependencies

Put app-specific behavior in its app and truly shared Web code in `packages/*`. Never import sibling repository source or combine user/admin trust boundaries.

- 两 app 都用的东西 → 抽 `packages/*`；app 专属（页面、业务组件、各自消息字典）留 `apps/*`。
- 新增共享包：`packages/<name>/package.json` 命名 `@kokoro/<name>`，app 以 `workspace:*` 依赖。
- 子仓各自独立锁定工具链：Session/Platform 拥有自己的 TypeScript、Vitest、Node types、包管理器与 lockfile。
  本仓只改自己的 `pnpm-lock.yaml`，不修改或合并兄弟仓依赖。

## Current gotchas

- **Acquisition shutdown**：User Web 保留固定 Site 的只读套餐/credit/account 展示与 Platform Public 合同绑定的卡密 preview→confirm→recover；checkout/mock-pay/refund BFF、购买 CTA、provider secret/SDK 仍禁止。卡密只走 server-only generated client，raw Code 不落状态/日志/响应。仓库门禁对两 app 的完整 API route inventory、Admin rewrite 清单、proxy egress 和 plans GET-only export 采用闭合 allowlist。Admin 的 manifests/billing-overview/user360/resource/action 先经过本地 BFF 深度正向 schema 过滤，payment module/metrics/orders/action 对浏览器恒不可达。
- **每 Site 一个独立 Web 项目**：Site factory 输出独立产品名、repository、artifact、release、cookie/account
  边界与 rollback 权；Web 仓不再提供一个共享 `apps/user` 作为生产部署入口。
- **`.npmrc` 使用 `node-linker=isolated`**（非 hoisted），防止 app/private package 依赖被根级幽灵依赖掩盖。切换
  linker 属根工具链迁移，必须以 clean install、两 app build/test 与 dependency-boundary evidence 证明，不能直接改。
- **jest-dom matchers 挂载**（`apps/user/tests/setup.ts`）：必须 `import * as m from "@testing-library/jest-dom/matchers"`
  + `expect.extend(m)`。用 `import "@testing-library/jest-dom/vitest"` 在 isolated 下会解析到异 vitest 实例，
  matcher 静默不注册（报 "Invalid Chai property: toBeInTheDocument"）。
- **i18n 分层**：解析引擎单一实现在 `@kokoro/i18n`（泛型于各 app 的 `Locale`/`MessageKey`），两 app 各自持有消息字典
  与 React 绑定（`apps/user/src/i18n`、`apps/admin/lib/i18n`）——字典属 app 专属，不上收共享包。
- **dev 起环**：仓根 `pnpm run dev` 只启动 reference fixture。真实 Site 必须在自己的项目中启动；Admin 独立启动。

## Verification

Run `pnpm -r lint`, `pnpm -r typecheck`, `pnpm test`, `pnpm run build:site`, and `pnpm run build:admin`.
CI 另跑 `pnpm audit --prod --audit-level high`；外部 Site 项目还必须执行模板内自己的 CI/artifact verification。
