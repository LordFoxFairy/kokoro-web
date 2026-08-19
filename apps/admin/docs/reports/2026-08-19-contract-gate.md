# Admin Generated Contract Gate

## 结论

| 字段 | 结果 |
|---|---|
| 批次 | generated ConnectRPC 与 Admin mutation 契约审计 |
| 状态 | `BLOCKED_BY_PUBLISHED_CONTRACT` |
| Admin 整体状态 | `NOT_READY` |

本批次没有修改 IAM、Root contract proto、consumer registry 或任何旧 Admin 项目，也没有将
provisional fixture schema 冒充 generated contract。

## 事实证据

- 当前 `contract/consumers.yaml` 声明 `kokoro-iam`、`kokoro-web` 与 `root-e2e` 等 consumer，
  没有 `kokoro-web-admin` 或等价 Admin consumer。
- `kokoro-iam` 的现有 proto closure 只有 `authentication.proto`、`authorization.proto` 和
  common types；它没有用户、Organization、Site、Membership、Role、Permission catalog、
  管理员 Session 或 Audit mutation service。
- Admin 当前 `src/lib/view-models` 明确标记为 `kokoro.admin.fixture.v2` provisional schema；
  `src/lib/data-source.ts` 对 `ADMIN_DATA_SOURCE=rpc` 返回结构化 `NOT_CONFIGURED`，没有 fake RPC。
- Root contract 工作树存在未提交注册源变更。生成器 `contract/generate.py` 对 registered source
  dirty 或与 source commit 不一致会 fail closed，因此本阶段不能从该状态写入可信 provenance。

## 不可越过的页面能力

以下操作没有版本化 IAM RPC，Admin 不实现猜测性 mutation：

- User 创建、编辑、启停、恢复/删除、角色分配和凭据生命周期。
- Organization 与 Site 创建、编辑、生命周期和成员关系。
- Role 创建、权限树保存、生命周期和成员授权。
- 任意管理员 Session 查询/撤销和 Audit 结构化详情 mutation 关联。

## 当前外部状态核验（2026-08-19）

- `../Kokoro/contract/consumers.yaml` 仍未新增 `kokoro-web-admin`（或等价命名）consumer。
- `kokoro-iam` only exposes authentication/authorization + common types；未见用户、组织、Site、成员、角色、权限、审计等 Admin services。
- 与上位 `contract` 仓库相比，当前 `../Kokoro/contract` 工作树同样处于脏状态，`contract` 生成工具仍处于 fail-closed，不可用于可信 BFF 生成。

## 下一阶段入口

必须先由 Root contract 发布版本化 service/message/error/scope/etag/idempotency/audit 语义，声明
Admin consumer，并从 clean source commit 生成 Protobuf-ES/Connect descriptors。随后 Admin 才能在
server-only BFF 中接入 generated Connect client，并让 fixture 与真实 client 共享 contract tests。
在此之前，按钮和页面不得伪造成功结果或跨 Site 数据，生产 Admin data source 继续 fail closed。
