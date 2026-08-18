# Admin 访问与安全 Loader 测试报告

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | Roles, members, sessions, audit and access diagnostics loaders |
| 代码基线 | `7288dbd` + 本批次变更 |
| Provisional schema | `kokoro.admin.fixture.v2` |
| 执行日期 | 2026-08-18 |
| 分类状态 | `PASS` |
| 页面与 UI 状态 | `NOT_READY` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test` | PASS；29 files，410 tests |
| TypeScript | `pnpm typecheck` | PASS |
| ESLint | `pnpm exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm format:check` | PASS |
| Production build | `pnpm build` | PASS；Next.js production build |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- 角色 loader 在 scope 选择不完整时保持 empty；platform scope 不虚构 ID，Organization/Site scope
  保留 opaque ID，scope 完整后只投影 scope、query、pageSize 与 opaque pageToken。
- 角色详情 loader 消费 URL 中的 opaque `roleId` 并调用权威详情契约，避免公开选择状态成为无效参数。
- provisional schema v2 尚未表达角色 `includeDeleted` 时，loader 返回稳定的结构化 invalid argument，
  不通过客户端过滤或本地生命周期集合伪装支持。
- 成员 loader 将权威 scope 及 query、sort、pageSize、opaque pageToken 原样交给 data client，不在前端
  推导 Organization、Site、角色或成员关系。
- 会话 loader 只投影 query、userId、显式 status 集合和 opaque 分页字段；空状态集合不扩展成前端维护的
  生命周期枚举。
- 审计 loader 投影 query、actorId、targetId、requestId、outcome、scope 与 opaque 分页字段；不完整、
  多值或互相矛盾的 scope 组合被显式拒绝。
- 角色、成员、会话和审计均区分初始空数据与筛选或分页后的 ready 空 Page，后者为后续 DataTable
  “无匹配结果”和分页边界保留稳定语义。
- 权限诊断 loader 只在 subject、scope、resource、action 完整时调用 `checkAccess`；platform scope 无 ID，
  Organization/Site scope 保留 ID；不完整表单保持 empty，允许/拒绝结论完全来自 data client。
- 所有 loader 统一通过共享 PageState 映射结构化错误；unauthenticated 独立于通用 error，未知异常使用
  调用上下文或稳定领域 fallback requestId，且不暴露后端消息。

## 边界结论

本批次证明的是 `kokoro.admin.fixture.v2` provisional view-model client 到访问与安全页面状态之间的纯
loader 边界。它验证请求投影、初始空态、筛选空态和错误映射，并确保前端不复制 IAM 的权限计算、
生命周期、租户关系或审计查询规则。

该 schema v2 仍是 Admin 内部 provisional fixture schema，不是版本化 Protobuf API 契约、生成类型或
ConnectRPC wire contract。production build 通过仅证明当前源码可构建，不证明任何真实页面已接线。

## 未验收项

- 官方 shadcn/ui Shell、DataTable、Dialog、Sheet、表单、搜索、响应式与可访问性实现。
- Auth.js 登录、Session 建立、保护路由、失效重定向与退出清理。
- App Router 的角色、成员、会话、审计和权限诊断真实页面及交互。
- 创建、编辑、授权、撤销和其他 mutation，以及对应回读与审计闭环。
- generated ConnectRPC 客户端、版本化 API 契约 fixture 与真实 IAM 联调。
- 组件测试、性能、首屏无闪动和浏览器视觉验证。
- 两轮可见内置浏览器 E2E，以及逐步截图、RPC、SQL、审计和日志证据。

因此 Admin 继续保持 `NOT_READY`，不得将本报告用作 UI、Auth、RPC、IAM 联调或产品验收证据。
