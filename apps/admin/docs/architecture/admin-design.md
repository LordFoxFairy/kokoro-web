# Admin 冻结技术方案

状态：已冻结。本文定义新 Admin 的目标架构；当前目录尚未包含应用实现，本文不代表功能已经交付。

## 1. 目标与边界

Admin 是独立的前端应用及其 BFF，负责管理界面的信息架构、交互、会话接入和 API 适配。IAM
仍是独立后端，负责领域规则、授权、事务和数据。此次重建不修改 IAM。

```text
Browser
  -> Next.js Admin（页面、Auth.js、BFF）
  -> 版本化 Protobuf/Buf 契约（Connect-ES + connect-node gRPC transport）
  -> IAM
```

双方只通过版本化 API 契约协作。Admin 不读取 IAM 数据库、不复制 IAM 业务规则；IAM 不定义
Admin 的路由、菜单、布局、组件或文案。任一方内部重构，只要契约未改变，就不要求另一方同步修改。

## 2. 固定技术栈

| 层级 | 固定选型 |
|---|---|
| 应用框架 | Next.js 16 App Router |
| 视觉底座 | 官方 shadcn/ui `dashboard-01` Block + CLI/Registry 原语 |
| UI | shadcn/ui + Radix UI |
| 样式 | Tailwind CSS 4 |
| 图标 | Lucide React |
| 表格 | TanStack Table |
| 表单 | React Hook Form + Zod |
| 认证 | Auth.js |
| 客户端服务状态 | TanStack Query，仅用于需要交互缓存的查询和 mutation |
| 后端调用 | Protobuf-ES 生成描述符 + Connect-ES 客户端 + connect-node gRPC transport |
| 测试 | Vitest、Testing Library、Playwright |

第三方后台模板、旧 Admin UI 和旧兼容路径不得重新引入。

## 3. 官方组件治理

| 能力 | 来源 | Kokoro 规则 |
|---|---|---|
| Sidebar、Header、Dialog、Sheet、Command | 官方 shadcn/ui Registry | 通过 CLI 按需生成并保留可访问性结构 |
| 主题与颜色 | shadcn semantic tokens + Tailwind CSS 4 | 默认浅色；不在页面散落原始颜色 |
| DataTable | 官方 Table 原语 + TanStack Table | 形成一个契约驱动的共享组合，不携带示例数据 |
| 表单 | 官方 Field 原语 + React Hook Form + Zod | 只校验输入形状和交互约束，不复制后端裁决 |
| 图标 | Lucide | 使用图标库已有图标；陌生图标操作提供 Tooltip |

组件增加或升级必须先通过官方 CLI 查看文档和 diff。页面只组合已登记原语；稳定且跨两个以上
feature 重复的模式才提升到共享组件。项目不保留第三方模板、框架适配器或示例页面。

`dashboard-01` 只提供官方 Shell 与组合结构，不提供 Kokoro 业务。其示例 JSON、图表指标、文档导航
和行数据在加入后立即删除；DataTable 按官方说明结合每个真实列表的服务端筛选与游标语义配置，
不抽象成包含所有领域行为的万能表格。

## 4. 目标目录

```text
apps/admin/
  src/app/
    (auth)/                 # 登录等未认证页面
    (console)/              # 认证后的管理路由与共享 shell
    api/auth/[...nextauth]/ # Auth.js Route Handler
    layout.tsx
  src/components/
    ui/                     # shadcn/ui 生成组件，仅做底层原语
    layout/                 # shell、sidebar、header、breadcrumbs
    data-table/             # 通用表格组合能力
    feedback/               # loading、empty、error、result
  src/features/
    dashboard/
    users/
    organizations/
    sites/
    members/
    roles/
    permissions/
    sessions/
    audit/
  src/lib/
    auth/                   # Auth.js 配置、session schema、route guard
    api/                    # BFF 调用入口、错误映射、分页适配
    view-models/            # UI 消费模型；不得冒充 Protobuf wire types
    query/                  # TanStack Query 装配与稳定 query keys
    fixtures/               # 仅 dev/test 使用的确定性 UI 数据场景
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

## 7. Fixture client 边界

Fixture 用于 IAM 尚未联调时独立开发 Admin，不是第二套业务实现。

- fixture client 必须实现与真实客户端相同的前端接口，并以契约版本分目录。
- fixture 数据只能从 `lib/fixtures` 注入，禁止散落在页面和组件中。
- production build 不得选择 fixture transport；环境 schema 在启动时拒绝该组合。
- fixture 覆盖成功、空、分页、禁止访问、校验错误、冲突和服务失败等边界。
- fixture 不定义新的字段、权限码或状态；契约没有的内容不能由前端自行补造。
- 接入服务端 Connect-ES client 时替换数据实现，不修改 feature 组件和页面语义。

## 8. 演进和质量门禁

新增页面必须先在组件矩阵中找到可复用模式，再增加领域配置和契约调用。稳定模式在两个以上 feature
出现且语义一致时才能提升到共享组件，禁止包装每个 shadcn 原语制造第二套 UI 框架。

每次底座或依赖升级必须通过：冻结安装、类型检查、Lint、单元测试、组件测试、生产构建、首屏无样式
闪动检查、桌面与移动端视觉回归、键盘操作与焦点检查，以及完整业务 E2E。测试通过只证明被覆盖行为，
不能替代契约和页面能力矩阵的逐项验收。
