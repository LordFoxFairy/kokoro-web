# Admin 页面 Loader 测试报告

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | Dashboard and directory page loaders |
| 代码基线 | `d389cd3` + 本批次未提交变更 |
| Provisional schema | `kokoro.admin.fixture.v2` |
| 执行日期 | 2026-08-18 |
| 分类状态 | `PASS` |
| 页面与 UI 状态 | `NOT_READY` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test` | PASS；25 files，387 tests |
| TypeScript | `pnpm typecheck` | PASS |
| ESLint | `pnpm exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm format:check` | PASS |
| Production build | `pnpm build` | PASS；Next.js production build |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- Dashboard loader 将 scope 与 request context 原样交给 data client，并区分 ready、初始 empty、partial
  和失败状态。
- Dashboard section 可用性进入共享 provisional view model；partial 不再读取 fixture 专属元数据，页面
  loader 与 fixture 场景保持边界隔离。
- Dashboard partial 保留仍可用的数据，并生成稳定、脱敏且带 requestId 的页面级 unavailable 错误。
- 用户、Organization、Site 目录 loader 通过显式重载保留各资源的 Page 类型，并投影查询、状态、排序、
  pageSize 与 opaque pageToken。
- `status=all` 不展开成前端维护的生命周期状态集合；状态解释权保留在后端契约。
- 当前 provisional 请求无法表达的 `includeDeleted` 组合和 Site `organizationId` 筛选会被显式拒绝，
  不以客户端过滤伪装完整结果。
- 只有无筛选、无 pageToken 的首个空页进入页面 empty；筛选或分页后的零结果仍是 ready 空 Page。
- 用户、Organization、Site 详情 loader 精确调用对应 client method，opaque entity ID 不经前端校验、
  修剪或改写。
- 结构化 AdminError 保留权威 requestId；未知异常使用调用上下文或稳定的资源级 fallback requestId。
- `UNAUTHENTICATED` 已从通用 error 中拆为独立页面状态，并纳入八态 exhaustive dispatcher。

## 边界结论

本批次证明的是 provisional view-model client 到页面状态之间的纯 loader 边界。它避免页面直接复制 IAM
生命周期、标识符和关联筛选规则，也为后续 Auth.js 失效 Session 重定向保留独立状态。

本批次尚未接入 App Router 页面、React 组件或浏览器，因此不证明页面可见、交互可用或视觉完成；
production build 通过仅证明当前源码可以构建。

## 未验收项

- 官方 shadcn/ui Shell、DataTable、Dialog、Sheet、表单、搜索与真实业务页面。
- Auth.js 登录、Session 建立、保护路由、失效重定向与退出清理。
- App Router 页面读取 URL 状态并调用本批次 loader。
- 具体 mutation、RHF/Zod 表单、权限树及审计回读。
- generated ConnectRPC 客户端、版本化契约 fixture 和真实 IAM 联调。
- 组件测试、响应式、可访问性、性能与首屏无闪动验证。
- 两轮可见内置浏览器 E2E，以及 RPC、SQL、审计、日志和逐步截图证据。

因此 Admin 继续保持 `NOT_READY`，不得将本报告用作页面闭环或产品验收证据。
