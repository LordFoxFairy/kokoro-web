# Admin 冻结技术方案

状态：已冻结。本文定义新 Admin 的目标架构；当前目录尚未包含应用实现，本文不代表功能已经交付。

## 1. 目标与边界

Admin 是独立的前端应用及其 BFF，负责管理界面的信息架构、交互、会话接入和 API 适配。IAM
仍是独立后端，负责领域规则、授权、事务和数据。此次重建不修改 IAM。

```text
Browser
  -> Next.js Admin（页面、Auth.js、BFF）
  -> 版本化 API 契约（generated ConnectRPC）
  -> IAM
```

双方只通过版本化 API 契约协作。Admin 不读取 IAM 数据库、不复制 IAM 业务规则；IAM 不定义
Admin 的路由、菜单、布局、组件或文案。任一方内部重构，只要契约未改变，就不要求另一方同步修改。

## 2. 固定技术栈

| 层级 | 固定选型 |
|---|---|
| 应用框架 | Next.js 16 App Router |
| 视觉底座 | `satnaing/shadcn-admin` 2.2.1，提交 `e16c87f213a5ba5e45964e9b67c792105ec74d26` |
| UI | shadcn/ui + Radix UI |
| 样式 | Tailwind CSS 4 |
| 图标 | Lucide React |
| 表格 | TanStack Table |
| 表单 | React Hook Form + Zod |
| 认证 | Auth.js |
| 客户端服务状态 | TanStack Query，仅用于需要交互缓存的查询和 mutation |
| 后端调用 | Protobuf 生成的 ConnectRPC 客户端 |
| 测试 | Vitest、Testing Library、Playwright |

Ant Design、ProComponents、Clerk、旧 Admin UI 和旧兼容路径不得重新引入。

## 3. 上游迁入、适配与删除

迁入遵守上游 MIT 许可证并保留版权声明。迁入的是经过审计的源码和交互模式，不是截图复刻。

| 上游能力 | 处理 | Kokoro 规则 |
|---|---|---|
| App shell、Sidebar、Header | 迁入并适配 | 保留视觉密度、响应式收起和移动端导航；路由改为 App Router |
| 主题、颜色变量、暗色模式 | 迁入并适配 | 以 shadcn CSS variables 与 Tailwind 4 为唯一 Token 来源；默认浅色 |
| DataTable、Toolbar、分页与列可见性 | 迁入并抽为共享组合组件 | 数据和分页改为 API 契约驱动，不携带 Demo 数据 |
| Dialog、Sheet、Dropdown、Command | 迁入 | 保留 Radix 可访问性语义；领域组件通过组合使用 |
| React Hook Form + Zod 表单模式 | 迁入 | 前端 schema 只校验输入形状和交互约束，不复制后端领域裁决 |
| feature 目录组织 | 迁入并适配 | 每个 IAM 管理能力拥有独立 feature；跨 feature 稳定模式才进入共享层 |
| Lucide 图标与 Tooltip 模式 | 迁入 | 禁止重复手写已有图标；陌生图标操作必须提供名称 |
| Vite | 删除 | 由 Next.js 16 构建与运行 |
| TanStack Router | 删除 | 由 App Router 文件路由和布局负责导航 |
| Clerk | 删除 | 由 Auth.js 服务端会话负责认证 |
| Zustand 认证状态 | 删除 | 身份权威来自 Auth.js Session；局部 UI 状态按需使用 React 状态 |
| Tasks、Chats、Apps、用户 Demo | 删除产品页面 | 可复用其通用交互模式，不展示无 API、无权限定义的示例业务 |
| Mock 领域数据 | 删除产品依赖 | 开发和测试仅通过明确的契约 fixture 注入 |

上游升级按固定提交进行差异审计：先比较上游变更，再选择性迁入共享底座，最后运行视觉、可访问性、
类型、构建和 E2E 回归。业务 feature 不直接依赖上游私有路径，避免升级扩散。

## 4. 目标目录

```text
apps/admin/
  app/
    (auth)/                 # 登录等未认证页面
    (console)/              # 认证后的管理路由与共享 shell
    api/auth/[...nextauth]/ # Auth.js Route Handler
    layout.tsx
  components/
    ui/                     # shadcn/ui 生成组件，仅做底层原语
    layout/                 # shell、sidebar、header、breadcrumbs
    data-table/             # 通用表格组合能力
    feedback/               # loading、empty、error、result
  features/
    dashboard/
    users/
    organizations/
    sites/
    members/
    roles/
    permissions/
    sessions/
    audit/
  lib/
    auth/                   # Auth.js 配置、session schema、route guard
    api/                    # BFF 调用入口、错误映射、分页适配
    contracts/              # 生成客户端公开入口与边界校验
    query/                  # TanStack Query 装配与稳定 query keys
    fixtures/               # 仅 dev/test 使用的版本化契约 fixture
    env/                    # 环境变量 schema；不暴露服务端 secret
  docs/
  tests/
```

依赖方向固定为：`app -> features -> shared components/lib -> generated contracts`。`components/ui`
不导入领域 feature；feature 之间不直接访问彼此内部文件。跨领域复用必须通过公开入口或提升到共享层。

## 5. 渲染与数据策略

- 页面布局、首屏身份检查和需要保护的初始查询优先在服务端完成。
- 需要即时筛选、分页、乐观反馈或 mutation 状态的区域使用 Client Component 和 TanStack Query。
- Server Component 与 Client Component 通过可序列化的明确 props 连接，不把服务端凭证或 transport
  实例传入浏览器。
- URL search params 是列表搜索、筛选、排序和分页的可分享状态；Dialog、Sheet 展开等瞬时状态留在本地。
- 加载、空、错误、禁止访问、删除确认和成功反馈都使用共享模式，不由每个页面单独设计。

## 6. 认证与授权边界

Auth.js 负责登录流程、HttpOnly Cookie、Session 建立、续期与退出。Admin 登录页只提交 Auth.js
支持的认证方式，不直接保存密码或 IAM token。

- 未认证访问由服务端 guard 导向登录页。
- 已认证不等于已授权；菜单和操作根据 API 返回的能力投影展示。
- 隐藏按钮只是体验优化。所有查询和 mutation 的最终授权仍由 IAM 执行。
- Next.js BFF 可执行前端路由级预检，但不得重新实现 IAM 的角色、生命周期或数据范围算法。
- 浏览器不得获得 IAM 内部地址、服务凭证、签名密钥或生成客户端的服务端 transport。
- Session 中只保存 UI 和 API 调用需要的最小身份信息；外部输入在 Auth.js 边界用 Zod 校验。

## 7. Fixture 边界

Fixture 用于 IAM 尚未联调时独立开发 Admin，不是第二套业务实现。

- fixture 必须实现与真实客户端相同的前端 port，并以契约版本分目录。
- fixture 数据只能从 `lib/fixtures` 注入，禁止散落在页面和组件中。
- production build 不得选择 fixture transport；环境 schema 在启动时拒绝该组合。
- fixture 覆盖成功、空、分页、禁止访问、校验错误、冲突和服务失败等边界。
- fixture 不定义新的字段、权限码或状态；契约没有的内容不能由前端自行补造。
- 接入 generated ConnectRPC 时替换 port 实现，不修改 feature 组件和页面语义。

## 8. 演进和质量门禁

新增页面必须先在组件矩阵中找到可复用模式，再增加领域配置和契约调用。稳定模式在两个以上 feature
出现且语义一致时才能提升到共享组件，禁止包装每个 shadcn 原语制造第二套 UI 框架。

每次底座或依赖升级必须通过：冻结安装、类型检查、Lint、单元测试、组件测试、生产构建、首屏无样式
闪动检查、桌面与移动端视觉回归、键盘操作与焦点检查，以及完整业务 E2E。测试通过只证明被覆盖行为，
不能替代契约和页面能力矩阵的逐项验收。
