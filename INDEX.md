# kokoro-web 架构地图

`kokoro-web` 是独立 Git 子仓库，管理两个独立部署的 Next.js 应用和仓内共享包。配置、
契约消费、生成、测试、CI 入口与验收证据均由本仓库管理，不依赖父仓库的集中生成器或
集中测试目录。

## 目录职责

```text
apps/
  user/     @kokoro/web-user   面向用户的工作台；通过 Session BFF 消费后端能力。
  admin/    @kokoro/admin-web  IAM 管理平台；Auth.js + ConnectRPC，无数据库直连。
packages/
  tsconfig/ @kokoro/tsconfig   仓内 TypeScript 基线。
  i18n/     @kokoro/i18n       framework-agnostic i18n 引擎。
```

根 `package.json` 与 `pnpm-workspace.yaml` 只负责 pnpm 工作区和跨成员门禁。每个应用自行
拥有运行配置、代码边界、测试目录和报告目录；共享代码只有在两个应用都稳定消费时才进入
`packages/*`。

## 边界与协作者

- `apps/user` 和 `apps/admin` 信任边界、Cookie、运行配置及部署目标完全独立，不合并为
  单一 Next.js 应用。
- `apps/user` 通过自己的 BFF 消费 Session 服务，浏览器不持有后端 bearer token。
- `apps/admin` 只通过仓内冻结并生成的 IAM RPC 契约消费 `kokoro-iam`；Auth.js 管理浏览器
  登录机械，IAM 管理用户、Session、组织、RBAC、幂等命令与安全事件。
- Admin Web 不拥有 SQL、数据库客户端、Prisma、通用网关 rewrite 或父仓库运行时配置。

## 工具链约束

- Node.js `22.x`、pnpm `11.2.2`、`node-linker=isolated`。
- Next.js `16.2.6`、React `19.2.4`、Ant Design `6.5.0`、Vitest `4.1.x`。
- jest-dom 运行时通过 `@testing-library/jest-dom/matchers` 挂载到当前 Vitest 实例；类型增强
  使用纯类型 import，避免 isolated linker 下出现第二个 Vitest 实例。
- 锁文件和依赖声明是本仓库权威；改动依赖后运行无冻结安装，再执行两个应用的全量门禁。

## Admin 扩展规则

修改 IAM 管理平台前先读 `apps/admin/INDEX.md`、PRD、技术方案与当前实施计划。新增能力必须
按 RPC client → query/action → schema/view model → route/component → classified tests 的纵向切片
闭环，并在真实路由可执行后才加入导航。禁止兼容旧路由或恢复第二套数据权威。

正式验收由 `apps/admin` 自己生成分类报告；最终两轮使用全新夹具和可见 Chromium，逐步记录
本地/UTC 时间、截图、trace、视频、HAR、RPC/日志/受限 SQL 证据及 SHA-256。
