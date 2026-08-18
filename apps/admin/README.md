# Kokoro Admin

Kokoro 的独立后台管理前端。

## 技术边界

- 唯一应用框架：Next.js 16 App Router
- 唯一组件来源：官方 shadcn/ui CLI 与 Registry
- 样式：Tailwind CSS 4
- 表格：TanStack Table
- 表单：React Hook Form + Zod
- 图标：Lucide
- 认证：Auth.js（实现阶段接入）
- IAM：仅通过版本化 API 契约和服务端 RPC client 接入

本仓库不保留 Vite 应用、TanStack Router、Clerk、第三方 Admin 模板或兼容适配器。

## 本地验证

```bash
pnpm typecheck
pnpm lint
pnpm build
```
