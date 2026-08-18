# Admin 页面与组件矩阵

状态：已冻结。本文定义目标组件体系和页面装配边界；当前 Admin 尚未实现这些组件。

## 1. 分层原则

```text
shadcn/ui primitives
  -> shared admin patterns
  -> IAM domain components
  -> route pages
```

- **原语层**保留 shadcn/ui 的开放源码组件，只处理可访问性、样式变体和基础交互。
- **后台模式层**组合原语形成跨领域稳定模式，不包含 IAM 字段和规则。
- **领域层**绑定生成契约类型、字段、权限标识和领域文案。
- **路由层**装配页面、scope、search params 与数据获取，不重复实现表格或表单。

不得为了统一命名而包装每个 Button、Input 或 Badge。只有语义稳定且在两个以上 feature 重复的组合
才能进入共享层。

## 2. 上游能力映射

| `shadcn-admin` 能力 | 新位置 | 适配边界 |
|---|---|---|
| Sidebar / NavGroup / NavUser | `components/layout` | TanStack Router link 改为 Next Link；菜单受页面能力投影控制 |
| Header / TopNav / ProfileDropdown | `components/layout` | 身份来自 Auth.js Session；不使用 Clerk |
| ThemeSwitch / ConfigDrawer | `components/layout` | 保留主题与布局偏好；默认浅色，不引入产品 Demo 设置 |
| DataTable / Toolbar / ViewOptions | `components/data-table` | 支持服务端游标分页、URL 筛选和权限化批量操作 |
| ConfirmDialog | `components/feedback` | 统一危险级别、对象名称、pending 与 API 错误反馈 |
| Tasks 表格交互模式 | 共享表格模式 | 迁移能力，不迁移 Tasks 页面和假数据 |
| Users Dialog / Action patterns | 领域表单参考 | 用 IAM 契约字段重写，不沿用 Demo schema |
| Chats 双栏与滚动模式 | 不进入当前产品导航 | 未来真实业务出现时再从固定上游提交选择性迁入 |

## 3. 共享组件矩阵

| 组件 | 职责 | 明确不负责 |
|---|---|---|
| `AdminShell` | Sidebar、Header、主内容宽度、移动端导航 | 鉴权和业务数据 |
| `PageHeader` | 标题、说明、breadcrumbs、主操作区 | 自行发请求 |
| `ScopeSwitcher` | 展示并切换已授权 scope | 推导可访问 scope |
| `DataTable` | TanStack Table 渲染、列显隐、选择、排序 UI | 客户端假排序完整数据 |
| `TableToolbar` | 搜索、筛选、重置、批量操作插槽 | 领域筛选枚举定义 |
| `CursorPager` | 不透明游标的前后导航和页大小 | 解析 token 或估算总数 |
| `FilterSheet` | 移动端与复杂筛选容器 | 保存领域状态 |
| `EntitySheet` | 快速查看实体摘要与相关操作 | 替代完整详情路由 |
| `FormDialog` | RHF 生命周期、提交状态、表单级错误 | 定义领域 schema |
| `ConfirmAction` | 危险操作确认、pending、防重复提交 | 决定操作是否允许 |
| `ActionGuard` | 根据契约能力投影隐藏或禁用操作 | 充当最终授权 |
| `StatusBadge` | 稳定状态到视觉变体的映射入口 | 创建前端私有生命周期 |
| `EmptyState` | 首次空、筛选为空的不同反馈 | 将请求失败显示为空 |
| `ErrorState` | 页面级错误、retry 和 request ID | 展示内部堆栈或敏感 metadata |
| `LoadingState` | 固定尺寸 skeleton，避免布局跳动 | 用 spinner 改变页面几何尺寸 |
| `DetailList` | 键值详情、复制和敏感值遮罩 | 猜测字段格式 |
| `AuditTimeline` | 通用审计事件时间轴 | 解释 IAM 未定义的风险等级 |

共享组件必须支持键盘访问、清晰焦点、Loading/Empty/Error/Forbidden 状态和稳定响应式尺寸。

## 4. 领域组件矩阵

| Feature | 核心组件 | 复用模式 |
|---|---|---|
| Dashboard | `MetricGrid`、`ActivityFeed`、`ScopeSummary` | PageHeader、LoadingState、ErrorState |
| Users | `UserTable`、`UserFilters`、`UserForm`、`UserDetails`、`UserActions` | DataTable、FormDialog、EntitySheet、ActionGuard |
| Organizations | `OrgTable`、`OrgForm`、`OrgDetails`、`OrgActions` | DataTable、FormDialog、ConfirmAction |
| Sites | `SiteTable`、`SiteForm`、`SiteDetails`、`SiteActions` | DataTable、FormDialog、ScopeSwitcher |
| Members | `MemberTable`、`MemberForm`、`MemberActions` | DataTable、FilterSheet、ConfirmAction |
| Roles | `RoleTable`、`RoleForm`、`RoleDetails`、`RoleActions` | DataTable、FormDialog、EntitySheet |
| Permissions | `PermissionTree`、`PermissionSummary` | ActionGuard、EmptyState |
| Sessions | `SessionTable`、`SessionDetails`、`SessionActions` | DataTable、DetailList、ConfirmAction |
| Audit | `AuditTable`、`AuditFilters`、`AuditDetails` | DataTable、FilterSheet、EntitySheet、DetailList |

Organization 和 Site 的角色交互复用同一个 `RoleWorkspace` 组合模式，通过明确 scope props 和契约
能力投影区分，不复制两套角色页面。用户、成员和角色的选择器只有在两个以上 feature 出现相同契约语义
后才提升为共享 `EntityPicker`。

## 5. 页面矩阵

路由名称表达信息架构，实际 URL 在 App Router 实现时保持短且稳定。

| 页面 | 主视图 | 必备交互状态 | 权限边界 |
|---|---|---|---|
| Login | Auth.js 登录表单 | 提交、字段错误、认证失败、失效回跳 | 未认证可见 |
| Dashboard | 当前 scope 摘要与近期活动 | loading、空、部分服务失败 | 页面能力 + 当前 scope |
| Users | 用户列表与详情入口 | 搜索、筛选、分页、创建、编辑、状态操作 | 每个查询与 mutation 独立能力 |
| User detail | 概览、访问关系、会话、审计 tab | tab 独立分页、not-found、forbidden | tab 和操作分别投影 |
| Organizations | 组织列表和生命周期操作 | 搜索、分页、创建、编辑、删除或恢复 | 组织能力 |
| Organization detail | 概览、成员、角色 | tab 独立状态、scope 切换、冲突 | 组织 scope 能力 |
| Sites | Site 列表和生命周期操作 | 搜索、分页、创建、编辑、删除或恢复 | Site 能力 |
| Site detail | 概览、成员、角色 | tab 独立状态、scope 切换、冲突 | Site scope 能力 |
| Roles | scope 内角色主从工作区 | 角色选择、创建、编辑、权限分配、生命周期 | scope + 精确操作能力 |
| Permissions | 权限目录与能力查看 | 搜索、展开、只读与可编辑状态 | 查询与分配能力分离 |
| Sessions | 会话列表与撤销 | 筛选、分页、详情、单个或批量撤销 | 会话查询与撤销能力 |
| Audit | 审计列表与详情 | 条件筛选、分页、详情、request ID 查询 | 审计查询能力 |

没有 API 契约或页面能力定义的模板页面不出现在导航。普通用户看不到管理入口；有管理能力的用户只看到
契约投影允许的 scope 和操作。

## 6. 表格与表单统一规范

### 表格

- 桌面端使用紧凑行高，移动端只保留关键列，其余进入 Sheet；禁止横向挤压到文字重叠。
- 第一列固定为实体主标识，最后一列为宽度稳定的操作菜单。
- 搜索、筛选、排序和分页映射到 URL；请求过程中保留表头和表格尺寸，避免闪动。
- 批量操作只在选中项且能力允许时出现，并显示影响数量。
- 空数据、筛选无结果、权限不足和请求失败使用不同状态，不共享同一句文案。

### 表单

- RHF 管理交互状态，Zod 校验浏览器输入形状；生成类型负责 API request 类型。
- 创建和编辑可以共享字段块，但使用各自 schema 和默认值，禁止用大量条件分支混成万能表单。
- 后端字段错误映射到对应控件；冲突和前置条件失败显示表单级反馈。
- Dialog 和 Sheet 打开时聚焦首个有效字段，关闭后焦点返回触发按钮。
- 提交期间禁用重复提交；失败保留输入；成功关闭并精确刷新相关 query。

## 7. 视觉与交互冻结

- 默认采用浅色、紧凑、企业后台风格；颜色由 shadcn CSS variables 统一控制。
- 页面采用固定 shell 和受约束内容宽度，不把所有模块无层级地铺满整个页面。
- Lucide 图标用于导航和熟悉操作；图标尺寸、按钮尺寸和表格操作列保持稳定。
- 不使用装饰性渐变、浮动色块、卡片套卡片或无业务意义的大标题。
- 路由切换提供与最终内容同几何结构的 skeleton，避免字体、侧栏和内容跳动。
- 字体由 Next.js font 或可靠系统字体栈在首屏确定，禁止客户端挂载后切换字体。

## 8. 完成证据

每个页面只有同时具备以下证据才算完成：页面能力与 API 方法映射、真实或契约 fixture 数据、所有交互
状态、精确权限投影、组件测试、键盘访问检查、桌面和移动截图、真实 API E2E。共享组件的存在不证明
业务闭环；模板页面能够渲染也不证明 Kokoro 页面已经完成。
