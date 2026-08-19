# Kokoro Admin

Kokoro 的独立后台管理前端。

## 技术边界

- 唯一应用框架：Next.js 16 App Router
- 视觉与组件组织底座：`satnaing/shadcn-admin@e16c87f`
- UI 原语来源：官方 shadcn/ui CLI 与 Registry
- 样式：Tailwind CSS 4
- 表格：TanStack Table
- 表单：React Hook Form + Zod
- 图标：Lucide
- 认证：Auth.js（实现阶段接入）
- IAM：仅通过版本化 API 契约和服务端 RPC client 接入

上游的布局和成熟组件模式适配到 Next.js；Vite、TanStack Router、Clerk、Demo 业务和示例导航
不进入生产运行时。来源和适配边界见 `docs/architecture/upstream.md`。

## 本地验证

```bash
pnpm typecheck
pnpm lint
pnpm build
```
