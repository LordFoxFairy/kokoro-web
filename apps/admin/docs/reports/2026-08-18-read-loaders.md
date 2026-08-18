# Admin 核心读取 Loader 测试报告

## 结论

| 字段 | 结果 |
|---|---|
| 代码基线 | `58bb95d` + 本批次变更 |
| Provisional schema | `kokoro.admin.fixture.v2` |
| 分类状态 | `PASS` |
| Admin 整体状态 | `NOT_READY` |
| Skip / Todo / Retry | `0 / 0 / 0` |

## 自动化结果

| 门禁 | 命令 | 结果 |
|---|---|---|
| 单元测试 | `pnpm test` | PASS；32 files，431 tests |
| TypeScript | `pnpm typecheck` | PASS |
| ESLint | `pnpm exec eslint . --max-warnings=0` | PASS；0 warnings |
| Prettier | `pnpm format:check` | PASS |
| Production build | `pnpm build` | PASS |
| Diff hygiene | `git diff --check` | PASS |

## 本批次覆盖

- 当前身份与 scope capability 投影，覆盖 platform、Organization 和 Site scope；空 capability 投影
  保持 ready，避免把“无授权”误作“无数据”。
- 权限目录按完整 scope 读取；不在前端计算权限闭包、父子关系、角色可变性或可分配规则。
- Session 与审计详情精确调用对应 client method，opaque ID 不做 trim、格式校验或生命周期判断。
- 统一覆盖 ready、empty、forbidden、not-found、unauthenticated 与未知异常 requestId 映射。

## 契约边界

本批次完成 provisional client 已提供的核心只读 loader。用户详情所需的成员关系和角色投影仍缺少
正式 client method，已保留在 API 契约缺口中；前端没有通过全量列表过滤或 fixture 规则模拟该能力。

当前 schema 仍是 Admin 内部 provisional fixture，不是生成 Protobuf 类型或 ConnectRPC wire contract。
官方 shadcn/ui 页面、Auth.js、App Router 接线、真实 IAM、mutation、组件测试、性能与两轮可见浏览器
E2E 均未完成，因此 Admin 保持 `NOT_READY`。
