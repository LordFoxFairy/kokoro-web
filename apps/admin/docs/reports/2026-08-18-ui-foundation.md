# Admin UI 基础状态测试报告

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | Route access, DataTable state and deterministic formatting |
| 代码基线 | `6aa3daa` + 本批次未提交变更 |
| 执行时间 | 2026-08-18T14:33:03-04:00 至 2026-08-18T14:33:09-04:00 |
| 分类状态 | `PASS` |
| React 组件状态 | `NOT_READY` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test` | PASS；16 files，227 tests |
| TypeScript | `pnpm typecheck` | PASS |
| ESLint | `pnpm exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm format:check` | PASS |
| Production build | `pnpm build` | PASS；Next.js 16.2.6 |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- 路由访问纯函数区分 public、authorized、login、forbidden 和 not-found。
- 未登录和过期 Session 使用同源安全 callback；页面能力投影不替代 IAM RPC 最终授权。
- DataTable 状态保留不透明游标和回退历史，query 改变时清空游标及选择。
- 行选择使用稳定 key；列可见性保持声明顺序并禁止隐藏最后一列。
- 日期、相对时间和数量使用显式 locale、timeZone 与 now，避免 SSR/浏览器默认环境漂移。
- 状态 label 使用穷尽映射，ID 省略保持确定性。

## 独立审查修正

- ISO instant 增加严格公历日期校验，拒绝 JavaScript 自动滚动的非闰年 `02-29` 等不存在日期。
- 路由访问决策拒绝无效注入时钟，避免 `NaN` 比较将过期 Session 误判为有效。

## 未验收项

- Auth.js 实际 Session、Route Handler、Cookie、登录和退出。
- 官方 shadcn/ui DataTable、Sidebar、Header、Dialog、Sheet 和表单组件。
- 页面接线、组件测试、响应式、可访问性和视觉验收。
- generated ConnectRPC、真实 IAM 权限与 mutation。
- 可见浏览器两轮完整 E2E 及 RPC、SQL、审计、日志证据。

本报告只证明三个纯前端基础模型通过，不代表 Admin 页面或业务闭环完成。
