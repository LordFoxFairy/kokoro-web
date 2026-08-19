# Admin 重建计划

状态：执行中。

## 阶段 1：冻结上游与单一运行时

- [x] 冻结 `satnaing/shadcn-admin@e16c87f` 来源、Git tree 和 MIT 许可证。
- [x] 建立唯一 Next.js 16 App Router 构建入口，不保留 Vite/TanStack Router 生产运行时。
- [x] 从生产导航移除 Tasks、Chats、Apps 等示例业务和 Demo 数据入口。
- [x] 保留官方 `components.json` 作为组件配置事实来源。
- [ ] 恢复上游差异审计，逐项分类 `adapted/productized/inactive/removed`。
- [ ] 完成依赖、类型、Lint 和生产构建门禁。

## 阶段 2：共享前端基建

- [x] 建立路由 registry、breadcrumb、统一页面状态和 production fixture 门禁。
- [ ] 迁入并适配上游 Sidebar、Header、Main、Breadcrumb、主题和移动导航模式。
- [ ] 迁入并产品化上游 DataTable、筛选、游标分页、列设置和批量操作模式。
- [ ] 建立 Field、FormDialog、ConfirmAction、Empty、Error、Forbidden 和 Skeleton 模式。
- [ ] 建立稳定语义 Token、字体和首屏主题策略，消除刷新闪动。
- [ ] 为共享模式补单元、组件、键盘、响应式和视觉测试。

## 阶段 3：认证与前端契约

- [x] 建立安全回跳、统一公开登录错误和严格 Session view model。
- [ ] 接入 Auth.js 服务端 Session、登录、退出和路由保护。
- [x] 定义临时 UI data interface、错误视图、能力投影和游标语义。
- [x] 建立确定性 fixture client 基线，覆盖查询、筛选、分页和边界错误。
- [x] 建立导航与显式能力投影模型；空能力不产生管理入口。
- [ ] 浏览器不导入 IAM transport、内部凭证或服务端 client。
- [ ] IAM 保持不动，缺失能力只记录，不在前端补造规则。

## 阶段 4：真实管理业务

- [x] 建立目录、访问控制和安全审计页面族的 URL search state 与 round-trip 测试。
- [ ] Dashboard。
- [ ] 用户与用户详情。
- [ ] Organization、Site 和成员工作区。
- [ ] 角色、权限树和权限诊断。
- [ ] 会话与审计日志。
- [ ] 每个页面完成 loading、empty、error、forbidden、conflict 和响应式状态。

## 阶段 5：RPC 与验收

- [ ] 接入 Protobuf-ES 生成类型/描述符和服务端 Connect-ES client。
- [ ] fixture client 与 RPC client 运行相同契约测试。
- [ ] 完成单元、组件、契约、权限、类型、Lint、构建和性能门禁。
- [ ] 完成首屏无闪动、响应式、可访问性和页面切换稳定性检查。
- [ ] 在可见内置浏览器执行两轮 fresh fixture 全业务 E2E。
- [ ] 输出截图、RPC、SQL、审计、日志和时间证据齐全的验收报告。
- [ ] 所有矩阵项通过后才标记 `ACCEPTED`。
