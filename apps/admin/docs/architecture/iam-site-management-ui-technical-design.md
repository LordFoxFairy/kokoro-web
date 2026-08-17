# IAM 与 Site 管理界面技术方案

## 1. 设计原则

Admin Web 是 server-rendered 管理 BFF。读取使用 Server Component query，命令使用 Server
Action，交互状态限制在最小 Client Component。所有 IAM 数据来自生成的 ConnectRPC client；
展示组件不导入生成消息、不读取 IAM SQL、不持有 workload/token secret。

## 2. 页面与模块

```text
app/(control)/
  users/                 用户列表与详情
  administrators/        管理员只读治理入口
  sessions/              Session 管理
  sites/                 Site 列表
  sites/[siteId]/         Site 详情 Tabs
  organizations/         Organization 列表与详情
  access/                 角色、权限、菜单、授权检查
  audit/                  安全事件

modules/site/
  schema.ts               RPC view model 的运行时边界
  query.ts                server-only 查询
  actions.ts              server-only 命令与错误映射
  site-table.tsx
  site-detail.tsx
  site-members.tsx
  site-access.tsx
  site-audit.tsx
```

Site 详情固定使用 Tabs：`概览 / 成员 / 权限 / 安全事件`。每个 Tab 独立读取和错误边界，路由切换
保持 PageContainer、摘要头和操作区尺寸稳定。

## 3. 成熟组件映射

| 场景 | 标准组件 |
|---|---|
| 平台壳层 | `ProLayout` |
| 页面头和命令 | `PageContainer` |
| 列表 | `ProTable` |
| 筛选 | `QueryFilter`, `ProFormText`, `ProFormSelect` |
| 创建/重命名 | `ModalForm` |
| 详情 | `ProDescriptions` + `Tabs` |
| 成员 | `ProTable` + `DrawerForm/ModalForm` |
| 权限 | Ant `Tree` + `Transfer`/受控 Checkbox 组 |
| 状态 | `Tag`, `Badge`, `Alert`, `Result`, `Empty`, `Skeleton` |
| 危险命令 | `Modal.confirm`/受控 `Modal` + reason field |

Kokoro wrapper 只统一密度、分页、URL 查询、错误反馈和 command context，不复制组件内部布局。

## 4. 组件清单与粒度

```text
components/platform/AdminPage          PageContainer 统一边界
components/platform/EntityHeader       详情摘要与状态
components/data/AdminTable             ProTable 密度、滚动、分页
components/data/StatusTag              生命周期状态映射
components/forms/CommandReasonField     原因与字符限制
components/forms/ExpectedVersionInput   隐藏版本提交
components/feedback/CommandResult       error code 映射
components/feedback/AsyncState          loading/empty/error/403/404
components/security/PermissionTree      分组权限树
components/security/AuthorizationCheck  用户/Site/权限检查表单
```

禁止创建通用“万能 EntityTable/EntityForm”。业务列、命令和权限必须留在对应 vertical module。

## 5. 数据与错误

- Query 参数先经 Zod 严格解析，再调用 generated client。
- RPC record 在 `modules/*/schema.ts` 转为只包含 UI 所需字段的 view model。
- Server Action 生成 command/request UUID，提交 reason 和 expected version。
- `invalid_argument` 映射字段；`last_owner` 保留对话框；`conflict` 刷新版本；`not_found` 不泄露
  跨 Site 目标；`permission_denied` 返回 403；认证错误进入登录。
- 成功命令 `revalidatePath` 精确刷新列表/详情，不全站刷新。

## 6. 导航与权限

Registry 项必须声明 route、label、icon、required permission、scope 和 order。Server shell 读取当前
actor 的权限投影后生成导航；直接访问 route 时再次实时授权。平台管理员 scope 与当前 Site scope
是不同入口，不根据 URL 自行提升。

## 7. 视觉与布局稳定性

- Theme token 是唯一颜色、圆角、字体和间距入口；业务组件不写散落十六进制颜色。
- 表格工具栏、筛选区和详情摘要使用稳定 min-height/grid tracks。
- Tab 内容区切换不改变 PageContainer 宽度；表格仅在自己的 region 横向滚动。
- 390px 下侧栏由 ProLayout 收起，页面命令换行，筛选单列，Drawer 全宽。
- 动效只使用 Ant 默认反馈，遵守 `prefers-reduced-motion`，不添加装饰动画。

## 8. 实现门禁

1. IAM provider commit、hash、Proto 和 API contract 已冻结并导入。
2. PRD、技术方案、页面/组件清单已提升到 Admin 子仓。
3. 每个 vertical slice 先写 component/integration/security 测试。
4. 页面完成后逐页截图检查，再进行全业务 E2E。
5. 最终报告按认证、用户、Site、Organization、权限、Session、审计、响应式分类。
