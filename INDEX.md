---
architectureIndex: 1
rootId: service.web
owners:
  - "@LordFoxFairy"
---

# kokoro-web（pnpm monorepo）

## Responsibilities

Own independently deployable user/admin Next.js applications and Web-only shared packages under one independently released Web repository.

## Non-responsibilities

Web does not execute Agent graphs, own Session/Platform business persistence, or share credentials/databases across service boundaries.

## Public boundary

`apps/user` is the Site user surface and BFF; `apps/admin` is the privileged operator surface; `packages/*` are repository-local shared Web packages.

## Callers and dependencies

Browsers call each app. User BFF calls Session HTTP/SSE; Admin server code calls Platform generated Connect services.

## Data ownership and events

Web owns cookies, rendering state, drafts, and client caches. Session owns conversations/events and Platform owns identity/commercial/admin facts.

## Runtime and security

Server-only credentials stay outside browser bundles, production hosts fail closed to trusted Site resolution, and Admin has no Platform database credential.

## Idempotency, failure, and recovery

Client commands carry stable identity; reconnect uses Session snapshots/cursors; Admin effects reconcile durable receipts after ambiguous timeouts.

## Extension rules and forbidden dependencies

Put app-specific behavior in its app and truly shared Web code in `packages/*`. Never import sibling repository source or combine user/admin trust boundaries.

## Current gotchas

The repository currently contains one user app and one Admin app; production Fleet still needs one independent product-named Web project/artifact per Site.

## Verification

Run `pnpm -r lint`, `pnpm -r typecheck`, `pnpm -r test`, and production builds for every deployable app.

## Detailed current map

Kokoro 的 web 子仓。一个仓库承载**两个独立部署的 Next.js app** + 共享包。收拢自
"用户面 web + 后台管理 admin 两处分散"，是"一个 web 子仓、方便管理"的落点。

## 目录职责与成员

```
apps/
  user/     @kokoro/web-user   面向用户的工作台。走 session BFF，从不直连 DB。Next16 / React19 / antd6。
  admin/    @kokoro/admin-web  运营后台。NextAuth + generated Connect client，RBAC 特权面。Next16 / React19 / antd6。
packages/
  tsconfig/ @kokoro/tsconfig   共享 TS 基线 base.json（app 各自 extends，只留 app 专属）。
  i18n/     @kokoro/i18n       framework-agnostic i18n 引擎（negotiate/translate/interpolate）。见其 INDEX。
```

- 工作区声明：`pnpm-workspace.yaml`（`apps/*` + `packages/*`）。
- 根 `package.json`（`@kokoro/web`）：`dev`/`build`/`start` 委派 `apps/user`；`lint`/`typecheck`/`test` 为 `-r` 全量。

## 关键协作者与边界

- **两 app 信任边界不同，不可混**：`apps/user` 只消费 session HTTP/SSE（web BFF 密封 cookie，浏览器不持 bearer）；
  `apps/admin` 使用 NextAuth，并通过本仓生成镜像调用 Platform Admin 私有 Connect 控制面。**故保持两个独立部署目标**
  （admin 宜挂内网/子域），绝不合成单 app。
- `apps/user` 上游：`kokoro-session`（契约类型见 `apps/user/src/contract/*`，由根仓 `contract/generate.py` 生成，**勿手改**）。
- `apps/admin` 上游：`kokoro-platform`（platform-admin 网关）。

## 运行时约束（踩过的坑，改动前必读）

- **`.npmrc` 当前使用 `node-linker=isolated`**（非 hoisted）。两个 app 已统一到 Next 16.2.6、React 19.2.4、
  antd 6.5.0 和 Vitest 4.1.x；isolated 仍用于防止 app/private package 依赖被根级幽灵依赖掩盖。切换 linker 属于
  根工具链迁移，必须以 clean install、两 app build/test 与 dependency-boundary evidence 证明，不能直接改。
- **jest-dom matchers 挂载**（`apps/user/tests/setup.ts`）：必须 `import * as m from "@testing-library/jest-dom/matchers"`
  + `expect.extend(m)`。**不要**用 `import "@testing-library/jest-dom/vitest"`——isolated 下它解析到异 vitest 实例，
  matcher 静默不注册（报 "Invalid Chai property: toBeInTheDocument"）。
- **Admin Auth generated mirror**：`apps/admin/lib/generated/contracts/**` 来自 Root Buf contract，必须提交且禁止手改；
  Admin runtime 只依赖本仓 mirror，不允许 sibling source import，也不持有 Platform DB credential。
- **dev 起环**：主仓 `scripts/closure-up.py` 的 `pnpm run dev`（在 web 根）经根 `package.json` 委派到 `apps/user`——
  迁移不改 closure-up。admin 不由 closure-up 托管（需另起 platform-admin 栈）。

## 扩展规则

- 两 app 都用的东西 → 抽 `packages/*`；app 专属（页面、业务组件、各自消息字典）留 `apps/*`。
- 新增共享包：`packages/<name>/package.json` 命名 `@kokoro/<name>`，app 以 `workspace:*` 依赖。

## 当前陷阱 / 欠账

- **跨仓工具链仍未对齐**：Web 两 app 已统一，但 Session/Platform 的 TypeScript、Vitest、Node types、package manager
  与 lockfile 仍分裂；目标版本与单根 lock 由 Wave 0 Spec 冻结，不在 Web 子仓局部升级。
- **i18n 仍两套**：`apps/user/src/i18n`（自造引擎 + 消息）与 `packages/i18n`（`@kokoro/i18n`，admin 用）并存。
  统一（user 切共享引擎、引擎泛型化）归 phase-3。
- **prod 构建上下文待 repoint**：`apps/user/Dockerfile` 随 app 迁深一层，生产 compose 的 build context/dockerfile 路径需更新（WS5）。
