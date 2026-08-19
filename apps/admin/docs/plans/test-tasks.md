# Admin 测试任务

状态：`FROZEN / NOT_READY`

本文冻结新 Admin 的测试范围、执行顺序和证据要求。本文是测试任务清单，不是测试结果；
任何未执行项、失败项或证据缺失项都会使整体状态保持 `NOT_READY`。

## 1. 测试边界

当前阶段只以临时的 provisional view-model fixture 验证前端视图模型和纯函数边界，不要求 IAM
进程或 IAM 数据库参与。它不是版本化 API 契约 fixture，也不证明生成类型或 wire contract 一致：

```text
Unit tests -> provisional view-model fixture
```

页面实现后、真实 IAM 联调前，才进入使用生成类型的版本化 API 契约 fixture 阶段：

```text
Browser -> Admin Next.js BFF -> generated-contract fixture
```

最终验收必须切换为真实链路：

```text
Browser -> Admin Next.js BFF -> server-only Connect-ES client -> IAM gRPC -> PostgreSQL
```

- 当前 provisional view-model fixture 使用 `kokoro.admin.fixture.v2`，不得表述为 IAM Protobuf
  契约或生成客户端的替代品。
- 后续 generated-contract fixture 与真实 IAM 必须使用同一生成类型、字段语义、错误码和权限码。
- fixture 只模拟预置响应，不复制 IAM 授权、生命周期或事务规则。
- provisional view-model fixture 或后续 generated-contract fixture 通过均不代表产品验收通过；真实 IAM
  两轮 E2E 通过后才能申请 `ACCEPTED`。
- 前端测试不直接读取或写入 IAM 数据库。SQL 只用于最终验收后的结果核验。
- 每个测试由 Admin 子仓库维护，不在父仓库建立集中测试仓库。

## 2. 硬性门禁

- 必测用例总数必须等于已执行用例数，且 `skip = 0`、`todo = 0`、`retry = 0`。
- 禁止通过重试掩盖不稳定性；任何重跑都必须作为一次新的、带独立时间戳的执行记录。
- 禁止以 fixture、单元测试、headless E2E 或人工描述替代可见内置浏览器验收。
- 禁止跳过权限拒绝、空态、错误态、加载态、并发提交和边界分页。
- 禁止只验证按钮可见；mutation 必须验证请求、结果、页面回读和审计记录。
- 自动化测试、两轮浏览器 E2E 和证据审计全部通过前，整体状态只能是 `NOT_READY`。
- 验收期间发现缺陷后，修复必须重新执行受影响模块及其上游、下游链路；不得只补跑失败步骤。

## 3. 自动化任务

### 3.1 单元测试

- [x] provisional v2 Zod 运行时边界：common、request、entity 和 response schema 均为 strict；覆盖
      合法数据、缺字段、额外字段、错误枚举、空值、超界值、不透明 token、ISO instant、分页和错误信封。
- [x] URL 查询状态：用户、Organization、Site、角色、权限诊断、会话和审计的已支持筛选、排序与
      scope 可稳定解析、序列化和 round-trip；非法值、默认值、重复参数及不透明分页 token 有单元断言。
- [x] URL 查询状态：目录 pageToken/pageSize、详情 Tab 和安全返回路径可稳定解析、序列化及
      round-trip；pageToken 绑定 query/filter/sort/scope/pageSize，禁止跨查询复用。
- [ ] URL 查询状态已在真实 App Router 页面中回读，并驱动 TanStack Table 与服务端请求。
- [x] 路由 registry 纯函数覆盖 Dashboard、全部顶层管理路由、用户/Organization/Site 详情路由、
      静态 breadcrumb 元数据与未知路由；尚未覆盖实际 App Router 页面或 breadcrumb 组件。
- [x] 日期、相对时间、数量、状态和标识符展示函数使用显式 locale/timeZone/now，严格拒绝非法
      公历日期、负数/非整数数量与未知状态，服务端与浏览器不依赖各自默认环境。
- [x] provisional view-model error 到 `error/unauthenticated/forbidden/not-found` 页面状态的纯函数
      映射覆盖全部当前错误码、requestId、字段错误和 retryable 元数据，且移除后端消息；页面状态
      dispatcher 另行覆盖
      `loading/ready/empty/error/unauthenticated/forbidden/not-found/partial` 八态。
- [x] 权限投影纯函数按显式 capability key 控制导航可见性；空能力、`allOf`、`anyOf`、组合条件和
      缺失能力均有单元断言，权限诊断 fixture 只返回预置结果而不在前端求值策略。
- [x] 通用 capability rule 供导航与命令复用，稀疏/畸形/访问器输入均 fail closed，不推导角色、
      通配符或权限闭包。
- [ ] DataTable 列定义、选择、批量操作资格和页码边界。
- [x] DataTable 纯状态模型覆盖不透明游标前进/回退、query/page size 重置、稳定行选择、列顺序与
      至少保留一列；尚未证明 TanStack Table 组件、批量操作资格或页面接线。
- [ ] 表单 schema、默认值、字段关联、提交转换和服务端错误映射。
- [x] 通用表单纯状态模型覆盖编辑、提交、成功、冲突、禁止、字段/表单错误、输入保留和乱序响应；
      尚未覆盖具体页面 Zod schema、RHF 组件和提交转换。
- [x] 危险操作确认纯状态模型强制有效对象上下文及 reason/精确文本之一，提交期间冻结输入，revision
      拒绝乱序结果；尚未覆盖 shadcn Dialog、焦点恢复和真实 mutation。
- [x] provisional Session view model 严格解析用户、到期时间、capability 和 scope，拒绝未知字段、
      Token/凭据字段、非法 scope 与非法到期时间。
- [x] 登录回跳纯函数只接受同源 HTTP/HTTPS 目标并降为相对路径；公开登录错误映射不泄露账号状态或
      后端消息。
- [ ] Auth.js Session 映射、未登录重定向和退出后的状态清理。
- [x] 纯路由访问决策覆盖公共/未知路由、缺失或过期 Session、安全 callback、已知页面能力和详情
      路由继承，并明确不替代 Auth.js Route Handler 或 IAM RPC 最终授权。
- [x] App Router 文件系统契约冻结登录、Console 业务页、403 与 404 的 route group、URL、页面文件、
      metadata 和 loader owner；受保护路由只能进入 Console group，文件路径必须由 URL 精确推导，
      特殊页面保持唯一，新增或漂移的 route/loader 映射 fail closed。该契约不代表页面文件已经实现。
- [x] 保护页面服务端编排先执行零 RPC 的路由终止决策，允许后并发加载当前身份、显式 scope 能力和
      页面内容；三路共享相同 scope/request context，并验证 Session、身份和能力投影属于同一主体，
      主体错配时清空全部载荷并 fail closed。租户数据隔离与 scope 授权由 IAM 保证，前端不复制规则。
- [x] Server PageState 到 Client props 的投影使用精确 Zod schema，拒绝循环、访问器、稀疏数组、
      非 JSON 值、危险原型/字段和凭据字段，输出深冻结；unauthenticated/forbidden/not-found 与固定
      错误码在类型及运行时同时绑定，错误投影不携带后端 message、stack 或 cause。
- [x] provisional view-model fixture client 的固定时钟/requestId、查询、筛选、排序、分页 token、
      详情、结构化错误、取消信号和预置权限诊断行为有单元断言。
- [x] provisional view-model fixture client 的 18 个 response methods 均由对应 strict response schema
      解析验证，覆盖 identity、capability、Dashboard、目录、详情、权限目录、Session、审计和权限诊断。
- [x] fixture client 的分页、scope、详情 ID 与权限诊断请求入口均执行 strict request schema；校验失败
      映射为稳定 AdminError，不向页面泄露 Zod 内部错误。
- [x] 审计 attributes schema 拒绝 Token、Cookie、密码、secret、Authorization、API key、private key
      等敏感键及 `__proto__`/`prototype`/`constructor`，并限制键值长度和属性数量。
- [x] 完整 AdminError envelope 使用 strict schema；页面控制字段使用前向兼容解析，仅含 `kind` 的畸形
      对象和 hostile revoked Proxy 均 fail closed，且不会因 Proxy trap 抛出未处理异常。
- [x] development/test fixture 场景按 operation 显式注入 ready/empty/forbidden/not-found/unavailable/
      partial，经 runtime-branded AdminEnv 与中央 data-source 门禁创建；production 和畸形配置 fail fast。
- [x] Dashboard loader 透传 scope/request context，区分 ready、初始 empty、契约声明的 section partial
      和结构化错误；partial 由共享 Dashboard view model 表达，不依赖 fixture 私有元数据。
- [x] 用户、Organization、Site 目录 loader 将已支持查询、显式状态、排序、不透明 pageToken 和
      pageSize 投影为 provisional 请求；不复制 IAM 生命周期规则，不在前端补做 Organization/Site
      关系筛选，并显式拒绝当前契约无法表达的筛选。
- [x] 目录 loader 仅将无筛选首个空页映射为页面 empty；筛选或分页后的零结果保留 ready 空 Page，
      供后续 DataTable 呈现“无匹配结果”及分页边界。
- [x] 用户、Organization、Site 详情 loader 精确调用对应 client method，opaque entity ID 原样传给
      权威后端，并覆盖结构化错误、未知错误 requestId 与独立 unauthenticated 页面状态。
- [x] 当前身份与 scope capability loader 精确调用对应 client method；platform、Organization、Site
      scope 原样传递，空 capability 投影保持 ready，不在前端推导授权结论。
- [x] 权限目录 loader 只读取权威目录，未选择 scope 和权威空目录使用 empty；不计算权限闭包、
      父子关系或可分配规则。
- [x] Session 与审计详情 loader 将 opaque ID 原样传给精确 client method，并覆盖 ready、404、
      unauthenticated、未知错误和稳定 requestId。
- [x] 角色 loader 仅在 scope 完整时请求数据，将 scope、query 与 opaque pageToken/pageSize 原样投影；
      `includeDeleted` 在 provisional schema v2 无对应字段时显式拒绝，不在前端模拟删除项语义。
- [x] 成员 loader 将权威 scope 与 query/sort/opaque pageToken/pageSize 原样投影，区分初始 empty 与
      筛选或分页后的 ready 空 Page，并保留独立 unauthenticated 页面状态。
- [x] 会话与审计 loader 仅投影 provisional schema v2 已表达的筛选和 opaque 分页字段；审计 scope
      组合在请求前做结构校验，不复制 IAM 授权、生命周期或审计查询规则。
- [x] 权限诊断 loader 仅在 subject、scope、resource、action 完整时提交预置 AccessCheckInput，直接呈现
      data client 的权威结果，不在前端计算角色、权限闭包或允许/拒绝结论。
- [x] 数据源选择纯函数只在显式选择且为 development/test 时允许 provisional view-model fixture；
      production、未配置 RPC 和未知数据源均稳定拒绝。
- [ ] generated-contract fixture 必须符合生成契约，不允许任意对象或 `any` 绕过验证。

### 3.2 组件测试

- [ ] App Shell：侧栏、Header、面包屑、命令搜索、用户菜单和移动端 Sheet。
- [ ] DataTable：加载、成功、空、错误、无搜索结果、分页和列显隐。
- [ ] Query Toolbar：搜索、组合筛选、重置、键盘操作和 URL 同步。
- [ ] Form Dialog/Sheet：创建、编辑、校验失败、提交中、服务端失败和关闭保护。
- [ ] Confirm Dialog：危险操作说明、取消、确认、重复点击保护和焦点恢复。
- [ ] Permission Guard：允许、拒绝、只读和直接路由访问。
- [ ] Status Badge、Copy Action、Entity Link、Audit Detail、Permission Tree。
- [ ] Toast 与页面级 Error Boundary 不得泄露内部错误或凭据。
- [ ] 所有交互控件具备可访问名称、焦点态和键盘路径。

### 3.3 契约测试

- [ ] Admin 只导入生成的 ConnectRPC 类型和客户端，不手写重复 DTO。
- [ ] 每个 query/mutation 的请求字段、响应字段、分页游标和枚举均校验。
- [x] 查询缓存 key 强制包含 identity、Scope、契约版本、领域、操作和规范化参数；platform/
      organization/site 严格隔离，拒绝敏感字段、getter、稀疏数组、循环和畸形运行时输入。
- [ ] 错误码映射覆盖 unauthenticated、permission denied、not found、conflict、invalid argument、rate limited 和 unavailable。
- [ ] generated-contract fixture 与当前契约版本建立版本锁定；契约变更必须使不兼容 fixture 测试
      失败。当前 `kokoro.admin.fixture.v2` provisional view-model fixture 不计为此项证据。
- [ ] BFF 不向浏览器暴露 IAM 地址、内部 Token、Cookie 内容或服务端堆栈。
- [ ] 最终联调对每个 Admin 调用验证生成客户端、真实 IAM 响应和运行时 schema 一致。

### 3.4 权限测试

- [ ] 未登录用户只能访问登录流程，保护路由统一跳转。
- [ ] 普通用户不显示管理入口，直接访问管理路由也被拒绝。
- [ ] Site 管理员只看到授权 Site 的数据和操作。
- [ ] Organization 管理员只看到授权 Organization 范围。
- [ ] 平台超级管理员具备明确定义的平台能力，不依赖邮箱或前端角色字符串推断。
- [ ] 列表、详情、菜单、按钮和 mutation 对同一权限码保持一致。
- [ ] 前端隐藏操作后，绕过 UI 直接提交仍由 Admin BFF 预检并由 IAM 最终拒绝。
- [ ] 权限变化后重新读取 Session/能力投影，旧页面不得继续允许操作。

### 3.5 静态与构建门禁

- [x] 已记录自动化批次的 TypeScript `tsc --noEmit` 严格类型检查通过。
- [ ] 完成源码边界审计，确认无新增显式/隐式 `any` 和宽泛边界对象。
- [x] 已记录自动化批次的 ESLint 通过且为 0 warnings。
- [ ] 本清单定义的单元和组件测试范围全部实现并全量通过。
- [x] 当前已实现单元测试在页面基础编排批次记录中 39 files、570 tests 全部通过，且
      `skip/todo/retry = 0/0/0`；这不代表本清单要求的单元测试范围或任何组件测试已完成。
- [ ] 为全量单元和组件测试配置并保存机器可读报告。
- [x] 已记录自动化批次的 Next.js 16 production build 通过。
- [ ] 依赖扫描确认不存在 Ant Design、ProComponents、Clerk 和旧 Admin 兼容依赖。
- [ ] 源码扫描确认不存在 Demo、mock product data、旧 Admin 路径和手写契约 DTO。
- [ ] 生成客户端可从固定契约输入重新生成，工作树无未说明生成差异。

### 3.6 性能与首屏样式

- [ ] 登录页、Dashboard 和最大数据表页面记录冷启动及暖导航指标。
- [ ] 页面切换有即时导航反馈，不因串行瀑布请求长时间无响应。
- [ ] 大列表分页、筛选和选择操作不造成可见布局跳动。
- [ ] 首屏 HTML 与首次截图包含完整样式，无 FOUC、字体闪动或图标占位闪动。
- [ ] 字体使用稳定加载策略；刷新前后文字尺寸和换行不变化。
- [ ] 桌面、窄桌面、平板和移动端无横向溢出、遮挡或不可触达操作。
- [ ] 性能阈值在实现冻结时写入测试配置；阈值未定义也视为门禁未完成。

## 4. 页面验收任务

每个页面均需验证 loading、success、empty、error、forbidden 和响应式状态；含 mutation 的页面还需
验证 validation、submitting、success、conflict 和 retryable failure。

### 4.1 认证与应用壳

- [ ] 登录：账号密码成功、错误凭据、禁用账号、Session 建立、回跳和退出。
- [ ] 开发账号工具：仅开发/测试环境可见，创建管理员、重复创建冲突和生产关闭。
- [ ] 应用壳：权限菜单、折叠侧栏、面包屑、命令搜索、主题、用户菜单和移动导航。
- [ ] 路由保护：未登录、无管理权限、失效 Session 和 IAM 暂时不可用。

### 4.2 Dashboard

- [ ] 权威汇总指标、关注事件、最近审计、快捷入口和时间窗口展示。
- [ ] 指标跳转保留正确筛选条件。
- [ ] 部分数据源失败时显示明确错误，不把缺失值伪装为零。

### 4.3 用户

- [ ] 用户列表：搜索、状态筛选、排序、分页、列设置和详情跳转。
- [ ] 创建用户：字段校验、成功回读、重复身份冲突和审计。
- [ ] 用户详情：基础资料、成员关系、角色、会话、审计 Tab。
- [ ] 编辑用户、启用、禁用、软删除和恢复。
- [ ] 分配/移除 Organization 与 Site 角色，验证数据范围和幂等冲突。
- [ ] 重置密码或凭据操作按契约验证，不展示或记录敏感值。

### 4.4 Organization

- [ ] Organization 列表、搜索、状态筛选、分页和详情跳转。
- [ ] 创建、编辑、软删除和恢复 Organization。
- [ ] 成员列表、添加、修改成员状态、移除和重复添加冲突。
- [ ] Organization 角色列表、创建、编辑、授权、删除/恢复和成员使用情况。
- [ ] 删除前置关系和并发状态由 IAM 决策，Admin 正确呈现业务错误。

### 4.5 Site

- [ ] Site 列表按权限范围展示，支持搜索、状态筛选、分页和详情跳转。
- [ ] 创建、编辑、软删除和恢复 Site。
- [ ] Site 与所属 Organization 的展示和选择遵循契约，不由前端推断关系。
- [ ] Site 成员添加、状态修改、移除和重复添加冲突。
- [ ] Site 角色创建、编辑、授权、删除/恢复和成员使用情况。
- [ ] 用户端嵌入入口只呈现当前授权 Site；独立 Admin 按平台权限呈现全局范围。

### 4.6 角色与权限

- [ ] Organization/Site scope 切换、scope 搜索和角色 master-detail 导航。
- [ ] 创建自定义角色、编辑名称与说明、软删除和恢复。
- [ ] 权限树加载、父子选择、半选状态、保存、取消和无变更提交。
- [ ] 系统保留角色的不可变操作正确禁用并解释原因。
- [ ] 角色使用成员可查看、复制标识并跳转用户详情。
- [ ] 权限变更后菜单、按钮、路由和 IAM mutation 结果一致。

### 4.7 会话

- [ ] 会话列表：用户、状态、时间和分页筛选。
- [ ] 会话详情字段语义清楚，不使用未定义的“访问凭证到期”等产品术语。
- [ ] 撤销单个会话、撤销用户全部会话、重复撤销和当前会话失效。
- [ ] 撤销后回读状态、重新访问保护路由和审计记录一致。

### 4.8 审计日志

- [ ] 按时间、操作者、对象、动作、结果和 requestId 筛选。
- [ ] 分页、详情 Drawer、请求关联和字段缺失状态。
- [ ] 创建、修改、授权、删除、恢复、登录和会话撤销均可定位对应记录。
- [ ] 审计展示屏蔽凭据、Token、Cookie、密码及内部堆栈。

## 5. 完整业务链路

以下链路必须从 UI 第一步执行至最终回读，不得拆成互不关联的局部测试：

- [ ] 管理员登录 -> Dashboard -> 用户创建 -> 详情回读 -> 审计定位 -> 退出。
- [ ] 创建 Organization -> 添加成员 -> 创建角色 -> 分配权限 -> 授予成员 -> 使用情况回读。
- [ ] 创建 Site -> 添加成员 -> 创建 Site 角色 -> 授权 -> Site 隔离验证。
- [ ] 禁用用户 -> 已有 Session 处理 -> 登录拒绝 -> 恢复用户 -> 登录恢复。
- [ ] 撤销会话 -> 原会话访问失败 -> 管理员列表回读 -> 审计定位。
- [ ] 软删除 -> 默认列表隐藏 -> 包含删除项查询 -> 恢复 -> 冲突处理 -> 回读。
- [ ] 降低管理员权限 -> 菜单消失 -> 直接路由拒绝 -> 直接 mutation 拒绝 -> 审计定位。
- [ ] IAM unavailable -> 页面错误与重试 -> IAM 恢复 -> 原操作成功且不重复提交。

## 6. 两轮可见浏览器 E2E

两轮均使用 Codex 内置可见浏览器，保持浏览器窗口打开供用户观察。每轮使用独立 fresh fixture，
不得复用上一轮产生的数据状态。

### Round 1：功能全链路

- [ ] 执行第 4 节全部页面用例。
- [ ] 执行第 5 节全部业务链路。
- [ ] 每一步记录浏览器时间、页面 URL、操作者和数据范围。
- [ ] 每一步保存操作前、关键交互和结果态截图。
- [ ] 每个 mutation 关联 RPC 请求/响应摘要、SQL 结果断言、审计记录和服务日志。

### Round 2：独立重演与边界

- [ ] 使用全新数据和 Session 独立重演全部页面及业务链路。
- [ ] 覆盖无权限、冲突、错误、空态、会话失效和服务恢复。
- [ ] 覆盖桌面与移动 viewport；关键密集页面增加平板 viewport。
- [ ] 验证刷新、前进后退、深链访问和多 Tab Session 变化。
- [ ] 再次采集完整截图、RPC、SQL、审计和日志证据，禁止引用 Round 1 证据代替。

## 7. 证据记录格式

每个 case 必须有唯一 `caseId`，所有证据目录以 `round/caseId/step` 组织。每一步至少记录：

| 字段 | 要求 |
|---|---|
| `startedAt` / `finishedAt` | 带时区的 ISO 8601 时间，由执行器产生 |
| `actor` | 测试身份标识，不记录密码或 Token |
| `scope` | platform、Organization 或 Site 及测试标识 |
| `url` | 操作时的真实页面地址 |
| `action` | 实际输入与点击动作 |
| `expected` / `actual` | 可比较的业务结果 |
| `screenshot` | PNG 文件及截图时间，覆盖关键状态 |
| `rpc` | 方法、requestId、状态码和脱敏字段摘要 |
| `sql` | 只读断言名称、行数和期望值，不记录连接凭据 |
| `audit` | auditId、requestId、action、result 和发生时间 |
| `log` | 服务、requestId、级别、时间和脱敏摘要 |
| `result` | `PASS` 或 `FAIL`，不得使用 `SKIP`、`TODO`、`FLAKY` |

截图不是唯一证据。页面显示成功但 RPC、SQL 或审计任一不一致时，该 case 必须判定 `FAIL`。

## 8. 最终报告任务

- [ ] 按认证、壳层、Dashboard、用户、Organization、Site、角色权限、会话、审计分类。
- [ ] 报告生成时间、代码提交、契约版本、fixture/IAM 版本、浏览器与 viewport。
- [ ] 汇总计划数、执行数、通过数、失败数、skip/todo/retry 数和整体状态。
- [ ] 建立 case 到截图、RPC、SQL、audit 和 log 的双向索引。
- [ ] 记录缺陷及修复提交，并链接修复后的完整重跑证据。
- [ ] 明确 Round 1 与 Round 2 的 fresh fixture 标识和独立执行时间。
- [ ] 全部门禁通过后才把报告整体状态改为 `ACCEPTED`。
