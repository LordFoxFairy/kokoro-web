# Admin 技术栈决策

状态：已批准，作为新 Admin 实现的硬约束。

## 决策

新 Admin 以 `satnaing/shadcn-admin` 为视觉、布局和组件组织底座，全面采用 shadcn/ui。

- 上游仓库：`https://github.com/satnaing/shadcn-admin`
- 审计基线：`e16c87f213a5ba5e45964e9b67c792105ec74d26`
- 上游版本：`2.2.1`
- 许可证：MIT；引入源码时保留版权和许可证声明

不是参照截图重新手写，也不是选择性挑选组件。先完整导入上游 272 个文件并通过原版门禁，
再在该代码基线上适配 Next.js、Auth.js 和 Kokoro 领域能力。完整来源和差异规则见
`../architecture/upstream.md`。

## 技术栈

| 能力 | 选型 |
|---|---|
| 应用与路由 | Next.js 16 App Router |
| UI | shadcn/ui + Radix UI |
| 样式 | Tailwind CSS 4 |
| 图标 | Lucide React |
| 表格 | TanStack Table |
| 表单 | React Hook Form + Zod |
| 认证 | Auth.js |
| 交互查询 | TanStack Query，仅用于需要客户端缓存的查询和 mutation |
| 后端契约 | Protobuf + generated ConnectRPC |
| 测试 | Vitest + Testing Library + Playwright |

## 上游适配

保留上游的视觉语言、布局骨架、feature 目录组织、可访问性、响应式行为和组合组件模式。

替换以下上游基础设施：

- Vite 与 TanStack Router 替换为 Next.js App Router。
- Clerk 替换为 Auth.js。
- Demo 数据和示例业务替换为 Kokoro 契约 fixture，最终由真实 API 提供数据。
- 模板中的 Tasks、Chats、Apps 等示例页面不进入产品。
- Zustand 不承担认证权威；认证状态来自服务端 Session。

## 前后端边界

Admin 与 IAM 只通过版本化 API 契约协作：

```text
Browser -> Admin Next.js BFF -> generated ConnectRPC -> IAM
```

- Admin 拥有页面、组件、交互、显示状态和前端路由。
- IAM 拥有领域规则、授权、事务、数据和 RPC 实现。
- 浏览器不持有 IAM 内部服务凭证。
- Admin 不读取 IAM 数据库，不复制 IAM 业务规则。
- IAM 不控制 Admin 的页面布局、菜单文案和组件形态。
- 任一方内部重构不得要求另一方同步修改；只有契约版本变化触发协作。

## 扩展规则

新增管理能力通常只需要：

1. 增加 feature 目录和路由页面。
2. 复用现有 DataTable、Form、Dialog、Sheet、状态和布局组件。
3. 增加领域列、字段、操作和权限投影。
4. 接入对应 API 契约和测试。

禁止为单个页面重新创建布局、表格、筛选器、弹窗或状态体系。只有跨两个以上 feature 的
稳定重复模式才提升为共享组件。

## 禁止项

- Ant Design 和 ProComponents。
- 恢复已删除的旧 Admin 页面、组件、样式或兼容路径。
- Clerk、模板 Demo 数据和模板示例业务。
- 手写 SVG 图标替代 Lucide 已有图标。
- 直接依赖 Radix 内部 DOM 或不稳定 CSS 选择器。
- 在前端实现 IAM 授权或生命周期规则。
