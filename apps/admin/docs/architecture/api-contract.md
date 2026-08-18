# Admin API 契约边界

状态：已冻结。本文件定义 Admin 对 API 的消费规则，不新增或修改 IAM RPC。具体 service、method、message
和 enum 名称以 IAM 发布的版本化 Protobuf 为唯一事实来源。

## 1. 唯一事实来源

```text
IAM versioned Protobuf
  -> pinned schema revision
  -> generated ConnectRPC TypeScript client
  -> Admin server-side API port
  -> feature
```

禁止手写与 Protobuf 重复的 request、response、enum 或错误码类型；禁止依据数据库表或页面需求猜测字段。
Admin 只升级明确固定的契约版本。契约变更先在 IAM 发布，再重新生成客户端并通过契约回归。

## 2. 前端 API port

feature 不直接创建 transport，也不依赖 ConnectRPC 的底层细节。`lib/api` 暴露按领域划分的窄接口，
真实实现调用 generated client，fixture 实现用于 dev/test。两种实现必须通过同一组 contract tests。

port 负责：

- 将页面输入构造成生成的 request message。
- 传递身份上下文、超时、取消信号和 request metadata。
- 对响应执行生成类型之外必要的运行时边界检查。
- 把 transport failure 映射为统一前端错误联合类型。
- 保留 IAM 的业务错误码、字段路径、request ID 和可重试语义。

port 不负责：

- 推导角色、权限、数据范围或生命周期结果。
- 将一个后端 mutation 拆成前端自行维护的多步事务。
- 用通用成功值吞掉部分失败。
- 将未知错误伪装成“无数据”或“无权限”。

## 3. 契约能力面

Admin 只消费 IAM 已发布的能力。目标页面需要的能力按领域归档；某项能力在当前契约中不存在时，页面
应保持不可用或不展示，先通过正式契约评审新增，而不是在前端模拟。

| 领域 | 契约类别 | 前端消费目的 |
|---|---|---|
| Identity | 当前身份、会话建立结果、能力投影 | 登录后身份显示、导航和路由预检 |
| User | 列表、详情、创建或更新、状态操作、访问关系 | 用户管理、详情和授权视图 |
| Organization | 列表、详情、生命周期、成员与角色关系 | 组织工作区 |
| Site | 列表、详情、生命周期、成员与角色关系 | Site 隔离工作区 |
| Membership | 查询、添加、更新、移除 | 组织与 Site 成员管理 |
| Role | 查询、详情、创建、更新、权限分配、生命周期 | 角色工作区 |
| Permission | 权限目录与当前主体能力投影 | 权限树、按钮与路由可见性 |
| Session | 列表、详情、撤销 | 会话管理 |
| Audit | 列表、详情、条件查询 | 操作审计与问题追踪 |

此表是消费分类，不声明 IAM 已经实现每个动作。生成客户端和契约测试是实际可用性的证据。

## 4. 分页、筛选与排序

列表契约统一采用服务端分页。Admin 不把已加载的一页当作完整集合进行客户端排序或过滤。

### 请求语义

- `pageSize`：正整数，默认值和最大值由契约定义；Admin 使用契约允许的值。
- `pageToken`：不透明游标；Admin 不解析、不拼接、不跨筛选条件复用。
- `query`：自由搜索词；空字符串在发送前归一为“未提供”。
- `filters`：使用契约定义的枚举或字段，未知筛选项不得透传。
- `sort`：只允许契约声明的字段和方向；UI 不展示后端不支持的排序。

### 响应语义

- `items`：当前页结果，可为空。
- `nextPageToken`：为空表示没有下一页，不代表总数为零。
- `totalCount`：仅在契约明确提供时显示；前端不得根据页长估算总数。
- 筛选、搜索、排序或 scope 改变时清空旧游标并从第一页请求。
- 不同列表、不同 scope 和嵌套 tab 各自持有独立游标，禁止共用分页状态。

URL 记录 `query`、筛选、排序和可表达的当前页导航状态。原始不透明 token 不进入日志或分析事件。

## 5. 错误契约

前端统一错误模型由 transport code、IAM 业务错误码和安全展示信息组成：

| 分类 | UI 行为 |
|---|---|
| `UNAUTHENTICATED` | 清理失效前端会话并进入登录流程，不显示权限不足 |
| `PERMISSION_DENIED` | 显示无权限结果；mutation 保留用户输入，不自动重试 |
| `INVALID_ARGUMENT` | 映射到契约给出的字段路径；无字段路径时显示表单级错误 |
| `NOT_FOUND` | 详情页显示不存在；mutation 提示对象可能已变化并刷新权威数据 |
| `ALREADY_EXISTS` / conflict | 显示明确冲突，不通过覆盖写或客户端改名规避 |
| `FAILED_PRECONDITION` | 展示 IAM 返回的业务前置条件，不由前端猜测修复步骤 |
| `RESOURCE_EXHAUSTED` | 按契约 retry 信息节流；无 retry 信息时不自动重试 mutation |
| `UNAVAILABLE` / `DEADLINE_EXCEEDED` | 查询可有限重试；mutation 先刷新或查询权威结果再决定是否重试 |
| 未知错误 | 通用失败态并携带安全 request ID；不暴露堆栈、内部地址或 metadata |

错误消息由前端根据稳定错误码本地化。后端 `message` 用于安全补充或日志诊断，不能作为前端控制流依据。
所有错误映射必须穷尽已知 code，未知 code 进入显式 fallback。

## 6. 权限契约

权限分为三个独立概念，不得混用：

1. **页面能力**：当前身份是否可以看见某个管理入口。
2. **操作能力**：当前 scope 下是否可以执行某个查询或 mutation。
3. **IAM 最终授权**：后端对每次请求执行的权威裁决。

API 返回稳定的能力标识和适用 scope。Admin 使用能力标识决定导航、按钮和只读状态，不根据角色名、
邮箱、用户 ID 或“超级管理员”文案推断权限。按钮隐藏或禁用不替代 IAM 鉴权；任何 mutation 都必须处理
`PERMISSION_DENIED`。

能力缓存 key 必须包含身份、scope 类型、scope ID 和契约版本。切换身份、Organization 或 Site 时失效
旧能力缓存，避免跨租户泄漏。

## 7. Mutation、并发与幂等

- 创建和高风险 mutation 使用契约支持的 idempotency key；前端不得复用到不同 payload。
- 更新使用契约提供的 version、etag 或等价并发令牌；冲突后刷新，不静默覆盖。
- 删除、恢复、撤销会话等操作展示对象名称与影响范围，并在确认后只提交一次。
- mutation 成功后按领域精确失效 query；不依赖整页刷新掩盖缓存错误。
- 返回成功前不做永久乐观状态。可逆的局部乐观反馈必须能在错误时完整回滚。

## 8. 安全与可观测性

- generated ConnectRPC transport 只在服务端创建，IAM 地址和服务凭证只存在于服务端环境。
- 浏览器到 Admin 使用同源请求、Auth.js Cookie 和 CSRF 防护；禁止把内部 bearer token 写入
  `localStorage`、URL 或客户端日志。
- Admin 生成或传递 request ID，并在安全错误页和测试证据中关联；不得记录密码、Session token、
  page token 或个人敏感字段。
- 超时、重试和取消策略按 method 类型集中配置，不由页面自行决定。
- production 禁止 fixture transport；启动时必须通过环境 schema 验证 transport 模式。

## 9. 契约变更规则

- 向后兼容字段只追加并保持既有 field number；删除和语义变化使用新契约版本。
- enum 新值进入前端时必须有 unknown 展示分支，不能导致页面崩溃。
- 重新生成的代码不得手工修改，生成命令、schema revision 和工具版本必须可追溯。
- 每次升级运行真实客户端与 fixture 的 contract tests，并验证分页、错误、权限和 mutation 语义。
- 只有生成代码和契约测试能够证明某项 RPC 可用；设计文档不能作为实现完成证据。
