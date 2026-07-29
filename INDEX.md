---
architectureIndex: 1
rootId: service.web
owners:
  - "@LordFoxFairy"
---

# kokoro-web（pnpm monorepo）

## Responsibilities

Own independently deployable user/admin Next.js applications and Web-only shared packages under one independently released Web repository.

工作区成员（`pnpm-workspace.yaml` = `apps/*` + `packages/*`）：

```
apps/
  user/     @kokoro/web-user   面向用户的工作台。走 session BFF，从不直连 DB。
  admin/    @kokoro/admin-web  运营后台。NextAuth + 本仓 generated Connect client 的 RBAC 特权面。
packages/
  tsconfig/ @kokoro/tsconfig   共享 TS 基线 base.json（app 各自 extends，只留 app 专属）。
  i18n/     @kokoro/i18n       framework-agnostic i18n 引擎（createI18n：negotiate/translate/interpolate）。见其 INDEX。
  session-client/              Root contract-bound Session HTTP/SSE client；只收 path transport，不收 URL/凭据/Site。
  chat-surface/                browser-safe Chat projection + assistant-ui adapter；Session 仍是持久化与终态真源。
```

两 app 锁在同一套栈：Next 16.2.12、React 19.2.8、antd ^6.5.0、Vitest 4.1.10。根 `package.json`（`@kokoro/web`）：
`dev`/`build`/`start` 委派 `apps/user`；`lint`/`typecheck` 为 `-r` 全量；`test` 先跑仓库契约
`test/repository/*.test.mjs`（CI workflow 形状 + 依赖安全）再跑各 workspace 包测试。

## Non-responsibilities

Web does not execute Agent graphs, own Session/Platform business persistence, or share credentials/databases across service boundaries.

## Public boundary

`apps/user` is the Site user surface and BFF; `apps/admin` is the privileged operator surface; `packages/*` are repository-local shared Web packages.

**两 app 信任边界不同，不可混**：`apps/user` 只消费 session HTTP/SSE（web BFF 密封 cookie，浏览器不持 bearer）；
`apps/admin` 使用 NextAuth，并通过本仓生成镜像调用 Platform Admin 私有 Connect 控制面。因此保持两个独立部署目标
（admin 宜挂内网/子域），绝不合成单 app。

## Callers and dependencies

Browsers call each app. User BFF calls Session HTTP/SSE; Admin server code calls Platform generated Connect services.

- `apps/user` 上游 `kokoro-session`：契约类型在 `apps/user/src/contract/*`，由根仓 `contract/generate.py` 从
  `contract/spec/*.yaml` 生成，**勿手改**。
- `packages/session-client/src/generated/*` 是新 Site Chat 的 Root 生成镜像；`packages/chat-surface` 只经该包消费
  Session 契约，不跨仓导入 Session 源码。当前 legacy flat snapshot/numeric cursor 会 fail closed，等待 Wave 3
  breaking browser contract 后才可进入 live BFF 接线。
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

- **Acquisition shutdown**：User Web 仅保留 Host→Site fail-closed 的套餐目录与 credit/account 只读展示；checkout/mock-pay/refund BFF、购买 CTA、provider secret/SDK 均禁止。仓库门禁对两 app 的完整 API route inventory、Admin rewrite 清单、proxy egress 和 plans GET-only export 采用闭合 allowlist。Admin 的 manifests/billing-overview/user360/resource/action 先经过本地 BFF 深度正向 schema 过滤，payment module/metrics/orders/action 对浏览器恒不可达。当前没有 Web redeem 实现，也不得用任意 commerce proxy 伪造闭环。
- **每 Site 一个独立 Web 项目**：仓内是共享能力源码（一个 user app + 一个 admin app）；生产 Fleet 仍需为每个 Site
  提供独立产品命名的 project、artifact、release 与 rollback 权。
- **`.npmrc` 使用 `node-linker=isolated`**（非 hoisted），防止 app/private package 依赖被根级幽灵依赖掩盖。切换
  linker 属根工具链迁移，必须以 clean install、两 app build/test 与 dependency-boundary evidence 证明，不能直接改。
- **jest-dom matchers 挂载**（`apps/user/tests/setup.ts`）：必须 `import * as m from "@testing-library/jest-dom/matchers"`
  + `expect.extend(m)`。用 `import "@testing-library/jest-dom/vitest"` 在 isolated 下会解析到异 vitest 实例，
  matcher 静默不注册（报 "Invalid Chai property: toBeInTheDocument"）。
- **i18n 分层**：解析引擎单一实现在 `@kokoro/i18n`（泛型于各 app 的 `Locale`/`MessageKey`），两 app 各自持有消息字典
  与 React 绑定（`apps/user/src/i18n`、`apps/admin/lib/i18n`）——字典属 app 专属，不上收共享包。
- **dev 起环**：主仓 `scripts/closure-up.py` 在 web 仓根 spawn `pnpm run dev`，经根 `package.json` 委派到 `apps/user`；
  admin 不由 closure-up 托管（需另起 platform-admin 栈）。

## Verification

Run `pnpm -r lint`, `pnpm -r typecheck`, `pnpm test`, and production builds for every deployable app.
CI（`.github/workflows/ci.yml`）另跑 `pnpm audit --prod --audit-level high`，并分别 build `@kokoro/web-user` 与 `@kokoro/admin-web`。
