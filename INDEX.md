# kokoro-web 架构地图

`kokoro-web` 是独立 Git 子仓库，管理独立 Web 应用和仓内共享包。配置、
契约消费、生成、测试、CI 入口与验收证据均由本仓库管理，不依赖父仓库的集中生成器或
集中测试目录。

## 目录职责

```text
apps/
  user/     @kokoro/web-user   面向用户的工作台；通过 Session BFF 消费后端能力。
packages/
  tsconfig/ @kokoro/tsconfig   仓内 TypeScript 基线。
  i18n/     @kokoro/i18n       framework-agnostic i18n 引擎。
```

根 `package.json` 与 `pnpm-workspace.yaml` 只负责 pnpm 工作区和跨成员门禁。每个应用自行
拥有运行配置、代码边界、测试目录和报告目录；共享代码只有在两个应用都稳定消费时才进入
`packages/*`。

## 边界与协作者

- `apps/user` 通过自己的 BFF 消费 Session 服务，浏览器不持有后端 bearer token。
- Admin 旧实现已在清理提交中整体移除。新 Admin 将作为独立应用重新引入，并只通过版本化
  API 契约与后端协作；前后端内部实现互不感知。

## 工具链约束

- Node.js `22.x`、pnpm `11.2.2`、`node-linker=isolated`。
- 各应用自行声明框架与 UI 依赖；根工作区不统一绑定具体 UI 框架版本。
- jest-dom 运行时通过 `@testing-library/jest-dom/matchers` 挂载到当前 Vitest 实例；类型增强
  使用纯类型 import，避免 isolated linker 下出现第二个 Vitest 实例。
- 锁文件和依赖声明是本仓库权威；改动依赖后运行无冻结安装，再执行两个应用的全量门禁。

## Admin 重建边界

新 Admin 以 `satnaing/shadcn-admin` 和官方 shadcn/ui 为 UI 基线，独立维护 PRD、技术方案、
API 契约、测试任务和验收报告。旧 Admin 文件、兼容路径和 Ant Design 实现不得恢复。
