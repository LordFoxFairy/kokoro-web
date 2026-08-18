# Admin API 契约缺口

状态：`OPEN / BLOCKS REAL IAM INTEGRATION`

本文记录页面规格与 IAM 已发布 Protobuf 之间的差距。`src/lib/view-models` 和
`src/lib/fixtures` 只用于 Admin UI 独立开发，不是 IAM wire contract，也不能证明后端能力存在。

## 已发布 IAM 能力

当前版本化 Protobuf 只覆盖：

- Magic Link 请求与消费。
- 当前 Session 刷新、退出和查询。
- 单次授权检查。
- 按 Host 解析 Site。

现有 `GetSession` 表示当前凭证对应的 Session，不等同于 Admin 按任意 Session ID 查询。

## P0 缺口

| 领域 | 缺少的查询 | 缺少的命令 |
|---|---|---|
| Identity/Auth | 当前身份详情、完整能力投影、认证方式 | 密码登录、管理员开发账号维护契约 |
| User | 列表、详情、关系、角色、会话和审计投影 | 创建、编辑、停用、恢复、软删除、恢复删除、凭据重置 |
| Organization | 列表、详情、删除项和关系查询 | 创建、编辑、软删除、恢复 |
| Site | Admin 列表、详情、Organization 过滤和范围查询 | 创建、编辑、暂停、恢复、软删除、恢复 |
| Member | 分页列表、详情、状态和角色关系 | 添加、完整角色集合替换、停用、恢复、移除、恢复删除 |
| Role | 列表、详情、使用成员分页 | 创建、编辑、完整权限集替换、软删除、恢复、成员授权 |
| Permission | 权限树、父子关系、排序、可分配状态 | 由 Role 命令保存完整集合 |
| Session | 管理员列表、任意详情和筛选 | 撤销单个、撤销用户或范围内全部 Session |
| Audit | 完整筛选、结构化详情、属性白名单 | 只读；无需前端写入命令 |

## 必须由 Protobuf 冻结

- Service、method、message、field number 和 enum。
- 稳定 capability key、scope 和防枚举的 `403/404` 语义。
- 生命周期状态机、内置角色不可变规则和 owner continuity。
- version/etag 或等价并发令牌。
- idempotency key、重放结果、command ID 和 affected count。
- 稳定业务错误码、字段路径、retry 信息和审计关联。
- 权限树、诊断 reason/evidence 和审计属性白名单。

Admin 不根据页面需要自行确定这些规则，也不把 fixture 场景提升为生产契约。

## 前端可继续完成

- Next.js 路由、页面结构、URL 筛选和响应式布局。
- Auth.js 浏览器 Session 壳层与统一公开错误状态。
- Loading、empty、error、forbidden、conflict 和 stale 状态。
- 表格、表单、Dialog、Sheet、权限树交互和危险操作确认。
- 确定性 fixture 场景及 UI 测试。

正式联调前必须生成 Protobuf-ES 类型和 service descriptors，并让 fixture 与 server-only
Connect-ES client 通过同一组 contract tests。缺少对应 Protobuf 的页面不得标记真实可用。
