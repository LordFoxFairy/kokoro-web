# Admin 状态边界测试报告

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | Capability rules, tenant query keys and form state |
| 代码基线 | `d392e39` + 本批次未提交变更 |
| 执行时间 | 2026-08-18T15:09:25-04:00 至 2026-08-18T15:09:31-04:00 |
| 分类状态 | `PASS` |
| 页面接线状态 | `NOT_READY` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test` | PASS；19 files，281 tests |
| TypeScript | `pnpm typecheck` | PASS |
| ESLint | `pnpm exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm format:check` | PASS |
| Production build | `pnpm build` | PASS；Next.js 16.2.6 |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- capability rule 统一使用 opaque `allOf`/`anyOf`，空规则与畸形输入默认拒绝。
- 导航复用统一能力求值器；求值结果不替代 IAM RPC 最终授权。
- Query key 包含 identity、Scope、契约版本、domain、operation 和 canonical params。
- Platform Scope 使用固定内部 segment；Organization/Site 强制携带各自 ID，未知 Scope 拒绝。
- Query 参数递归拒绝敏感字段、getter、稀疏数组、循环、非有限数和触发异常的 Proxy。
- 表单状态保留输入，只把已声明字段路径映射为字段错误，后端 message 不进入展示状态。
- revision 使旧提交结果不能覆盖后续编辑或新提交；未知错误码稳定降为通用 error。

## 独立审查修正

- 修复稀疏 `allOf` 被 `Array.every` 跳过而导致的能力 fail-open。
- 修复 QueryScope 强制 platform ID 并接受任意 scope type 的契约偏差。
- 使用 null-prototype field error map 并拒绝 `__proto__` 等危险字段名。
- 拒绝对象及数组 accessor，避免缓存键读取值与实际请求值漂移。
- 为表单提交增加 revision，拒绝乱序成功/失败响应。
- 未知未来错误码显式映射为安全通用错误状态。

## 未验收项

- 具体业务表单 Zod schema、RHF 接线、字段关联与 mutation 转换。
- Auth.js、官方 shadcn/ui Shell、DataTable、Dialog、Sheet 和真实页面。
- generated ConnectRPC、真实 IAM 查询/mutation、权限与审计联调。
- 组件、响应式、可访问性、性能及两轮可见浏览器 E2E。

本报告只证明三个共享纯状态边界通过，不代表 Admin 页面或业务闭环完成。
