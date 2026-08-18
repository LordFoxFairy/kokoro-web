# 上游基线

状态：已完整导入并验证。

## 来源

- 仓库：`https://github.com/satnaing/shadcn-admin`
- 提交：`e16c87f213a5ba5e45964e9b67c792105ec74d26`
- Git tree：`35ae1233fc1231724604c5012fb62f5302702706`
- 版本：`2.2.1`
- 文件数：`272`
- 许可证：MIT，正文保留在 `apps/admin/LICENSE`

## 导入原则

`apps/admin` 先完整导入上游提交，而不是从空目录选择性重写。导入范围包括：

```text
public/
src/assets/
src/components/
src/config/
src/context/
src/features/
src/hooks/
src/lib/
src/routes/
src/stores/
src/styles/
src/test-utils/
src/main.tsx
src/routeTree.gen.ts
```

同时保留上游 package、TypeScript、Vite、ESLint、Prettier、shadcn、测试和构建配置作为
可运行起点。Kokoro 的 `docs/` 是唯一不属于上游 tree 的初始附加目录。

## 基线验证

完整导入时执行以下检查：

- 上游工作树与 `apps/admin` 排除 `docs` 和运行产物后 `diff -qr` 无差异。
- 上游独立 lockfile 冻结安装通过。
- Lint 通过。
- 21 个测试文件、130 个测试通过。
- TypeScript 与 Vite production build 通过。

适配过程中允许文件发生变化，但每个变化必须能归类为 Next.js、Auth.js、Kokoro API、
产品信息架构或测试适配。禁止以“重新设计”为由替换已经成熟的布局和组件模式。

## 适配边界

- `src/app` 最终接替 TanStack Router 的运行职责，但上游页面结构和 feature 组件先保留。
- Auth.js 最终接替 Clerk 和演示认证状态。
- Tasks、Chats、Apps 等源码作为上游能力保留；在没有真实 Kokoro 业务契约时不进入生产导航。
- Demo 数据逐 feature 被版本化契约 fixture 替换，不能一次性删除后再从空白重写页面。
- 上游组件只有在不符合 Kokoro 业务、无障碍或安全边界时才修改，并为修改增加测试。

## 差异审计

后续维护上游文件分类表：

| 分类 | 含义 |
|---|---|
| unchanged | 与冻结上游文件一致 |
| adapted | 保留上游职责，因 Next/Auth/API 做有测试的修改 |
| productized | 上游 feature 已接入真实 Kokoro 页面和契约 |
| inactive | 源码保留，但没有真实业务所以不进入生产导航 |
| removed | 仅限确认无价值且有批准记录的文件 |

任何上游文件不得在没有分类和理由的情况下消失。
