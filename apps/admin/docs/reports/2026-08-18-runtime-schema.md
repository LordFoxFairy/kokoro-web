# Admin 运行时 Schema 测试报告

## 结论

| 字段 | 结果 |
|---|---|
| Schema | `kokoro.admin.fixture.v2` |
| 分类状态 | `PASS` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test` | PASS；36 files，497 tests |
| TypeScript | `pnpm typecheck` | PASS |
| ESLint | `pnpm exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm format:check` | PASS |
| Production build | `pnpm build` | PASS |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- 建立 strict Zod common schema：entity ID、ISO instant、opaque string、bounded text、Scope、排序、
  Page、DataResult 和 AdminError；拒绝额外字段、非法枚举、非法日期、控制字符和越界集合。
- 建立 strict request schema：状态目录、scope 目录、Session、审计分页和权限诊断请求；限制
  pageSize、pageToken、query、sort、status 与 scope 形状，不接受 provisional v2 未声明的字段。
- 建立 strict entity schema：用户、Organization、Site、成员、权限、角色、Session、审计事件、
  权限诊断、Dashboard、当前身份和 capability projection。
- fixture client 的真实请求入口和 18 个 response methods 已分别接入精确 schema，覆盖
  identity、capability、Dashboard、用户、Organization、Site、成员、角色、权限目录、Session、
  审计与权限诊断的列表和详情结果。
- hostile Proxy、额外请求字段与非法 caller requestId 在实际 fixture 入口映射为稳定 AdminError；合法
  opaque ID 保留空格/斜杠，控制字符不会进入路由、日志或关联证据。
- 审计 attributes 拒绝 Authorization、Cookie、密码、Token、secret、API key、private key 等
  敏感键，拒绝 `__proto__`、`prototype`、`constructor`，并限制属性数量及键值长度。
- 未分页集合使用 10,000 条高位传输宽度保护，明确不作为 IAM 领域容量或前端裁剪规则。
- 完整 AdminError envelope 保持 strict；页面控制流另用稳定字段解析，允许服务端增加字段而不把
  UNAUTHENTICATED/PERMISSION_DENIED 降为 UNKNOWN。revoked Proxy 稳定 fail closed 且不抛异常。

## 边界与未完成项

本批次 Schema 仍属于 Admin 内部的 `kokoro.admin.fixture.v2` provisional view model，只证明当前
fixture 数据在运行时满足已声明的前端边界。它不是生成 Protobuf 类型、ConnectRPC wire contract
或真实 IAM 响应一致性的证据，也不会替代后续 generated-contract fixture。

generated ConnectRPC、真实 IAM 接入、官方 shadcn/ui 页面装配、Auth.js、组件测试、性能与响应式
验证，以及两轮可见内置浏览器 E2E 均未完成。因此本批次分类为 `PASS`，Admin 整体继续保持
`NOT_READY`，不得标记 `ACCEPTED`。
