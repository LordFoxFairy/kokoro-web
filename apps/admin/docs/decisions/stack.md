# Admin 技术栈决策

状态：已批准，作为新 Admin 实现的硬约束。

## 决策

新 Admin 的视觉、布局和组件组织建立在冻结的
`satnaing/shadcn-admin@e16c87f213a5ba5e45964e9b67c792105ec74d26` 之上，并适配到
Next.js App Router。shadcn/ui 原语仍只通过官方 CLI 或 Registry 管理；项目不维护双运行时。

Admin Shell 迁入并适配上游 Sidebar、Header、Main、Command、主题、响应式和 DataTable
组合方式。删除示例数据、示例指标和示例导航，替换为 Kokoro 页面与契约 fixture。登录页采用
shadcn/ui 表单组合规范，但不提供公开注册。

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
| 后端契约 | Protobuf-ES 生成类型/描述符 + 服务端 Connect-ES client |
| 测试 | Vitest + Testing Library + Playwright |

## 组件治理

- `components.json` 是组件配置的唯一事实来源。
- 官方原语必须由 CLI 写入；组合层按冻结上游提交适配，不根据截图重新实现。
- 增加或升级组件前先运行官方 CLI 的 `info`、`docs`、`--dry-run` 与 `--diff`。
- `components/ui` 只保存 CLI 生成的原语；领域组合放在 feature 或明确的共享模式目录。
- 不包装每一个原语，不建立第二套设计系统，不复制示例业务代码。

## 前后端边界

Admin 与 IAM 只通过版本化 API 契约协作：

```text
Browser -> Admin Next.js BFF -> server-only Connect-ES client -> IAM gRPC
```

- Admin 拥有页面、组件、交互、显示状态和前端路由。
- IAM 拥有领域规则、授权、事务、数据和 RPC 实现。
- 浏览器不持有 IAM 内部服务凭证。
- Admin 不读取 IAM 数据库，不复制 IAM 业务规则。
- IAM 不控制 Admin 的页面布局、菜单文案和组件形态。
- 任一方内部重构不得要求另一方同步修改；只有契约版本变化触发协作。

## User Web 后续约束

- 对外用户端后续统一迁移到官方 shadcn/ui，不再引入另一套 UI 体系。
- User Web 与 Admin 是两个独立应用，分别构建、部署和迭代，不共享页面或业务 feature。
- 两端只共享经过验证的设计 token、官方 UI 原语使用规范，以及确有复用价值的无业务基础组件。
- 当前阶段只闭环 Admin；User Web 改造另立方案和任务，不进入本轮实现范围。

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
- 除已冻结的 `satnaing/shadcn-admin@e16c87f` 外的后台模板、示例数据和示例业务。
- 手写 SVG 图标替代 Lucide 已有图标。
- 直接依赖 Radix 内部 DOM 或不稳定 CSS 选择器。
- 在前端实现 IAM 授权或生命周期规则。
