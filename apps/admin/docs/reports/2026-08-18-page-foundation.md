# Admin 页面基础编排测试报告

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | App Router contract, client props and server page orchestration |
| 代码基线 | `e7f5e3a` + 本批次未提交变更 |
| Provisional schema | `kokoro.admin.fixture.v2` |
| 执行日期 | 2026-08-18 |
| 分类状态 | `PASS` |
| 页面与 UI 状态 | `NOT_READY` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm --filter @kokoro/admin test` | PASS；39 files，570 tests |
| TypeScript | `pnpm --filter @kokoro/admin typecheck` | PASS |
| ESLint | `pnpm --filter @kokoro/admin exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm --filter @kokoro/admin format:check` | PASS |
| Production build | `pnpm --filter @kokoro/admin build` | PASS；Next.js 16.2.6 production build |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- 文件系统路由契约将登录、Console 业务页面、403 和 404 的 group、URL、目标文件、标题及 loader
  owner 固定为单一映射。保护路由不得漂移到 auth layout，文件路径必须与 URL 推导结果一致。
- loader owner 使用 route-to-owner 精确合同；未登记的新路由、缺失 owner 或错误 owner 均 fail closed，
  `/forbidden` 是唯一受保护但不加载业务数据的显式例外。
- Server 页面编排在访问决策拒绝时不发出 RPC；允许后并发加载当前身份、scope capability 和页面内容，
  三路原样共享显式 scope 与 request context。租户数据隔离和 scope 授权由 IAM 契约保证，Admin 不在
  前端复制 Site/Organization 隔离或层级授权规则。
- Session user、当前身份及能力投影必须属于同一主体。ready/partial 数据发生主体错配时，编排器丢弃
  三路载荷并返回无主体标识、无后端消息的 `FAILED_PRECONDITION` 失败状态。
- 终止顺序固定为 unauthenticated、forbidden、主体一致性、content not-found、render；身份串线不能
  被伪装成业务页面 404，身份或能力的 not-found 也不会被误解释为内容 404。partial 数据保持独立
  状态，普通错误不会伪装成 ready。
- Server PageState 经过精确 Zod schema 投影为不可变 Client props；循环、访问器、稀疏数组、类实例、
  非 JSON 数值、Symbol、危险原型键及凭据字段均被拒绝。
- unauthenticated、forbidden 与 not-found 在类型和运行时分别绑定 `UNAUTHENTICATED`、
  `PERMISSION_DENIED` 与 `NOT_FOUND`，冲突状态 fail closed；Client 错误只保留结构化安全字段。

## 独立审查

三块初始实现经过交叉审查，发现并修复以下问题后重新执行全量门禁：

- 保护路由可能漂移出 Console layout，loader owner 也未受契约验证。
- 内容 loader 未显式接收 scope，Session、身份和 capability 主体可能发生串线。
- 页面终止状态与错误码可能冲突，导致普通故障被解释为登录、403 或 404。

修复后的第二次审查范围内未保留已知 P1/P2。

## 未验收项

- 本批次只冻结目标 App Router 文件，不代表登录或 Console 页面已创建。
- 官方 shadcn/ui Shell、DataTable、Dialog、Sheet、表单、搜索和真实业务组件尚未迁入。
- Auth.js、generated ConnectRPC、版本化 generated-contract fixture 和真实 IAM 尚未接入。
- npm/shadcn 官方依赖安装仍等待当前 Codex 任务以允许网络的执行沙箱重新载入。
- 组件、可访问性、响应式、性能、首屏无闪动和两轮可见内置浏览器 E2E 尚未执行。
- RPC、SQL、审计、日志和逐步截图证据尚未形成。

因此本批次分类为 `PASS`，Admin 整体继续保持 `NOT_READY`，不得用于产品验收或标记 `ACCEPTED`。
