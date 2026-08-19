# shadcn-admin 上游基线

状态：`FROZEN / ADAPTING`

## 来源

- 仓库：`https://github.com/satnaing/shadcn-admin`
- 提交：`e16c87f213a5ba5e45964e9b67c792105ec74d26`
- Git tree：`35ae1233fc1231724604c5012fb62f5302702706`
- 上游版本：`2.2.1`
- 许可证：MIT，正文保留在 `apps/admin/LICENSE`

## 采用范围

Admin 以该冻结提交的视觉、布局和组件组织为实际底座，并迁入、适配以下成熟模式：

- Sidebar、Header、Main、用户菜单和主题切换。
- Command 搜索、响应式导航、焦点和可访问性模式。
- TanStack DataTable、筛选、列设置、分页和行操作。
- Dialog、Sheet、确认操作、RHF/Zod 表单和反馈状态。

上游是 Vite + TanStack Router 应用，Kokoro Admin 的运行时固定为 Next.js 16 App Router。因此，
迁入的是视觉结构、组件职责和交互模式，不保留第二套路由或构建运行时。

## 产品化规则

- `Tasks`、`Chats`、`Apps` 等模板业务不进入生产导航，也不作为 Kokoro 业务数据源。
- 上游 feature 中成熟的表格、Dialog、Sheet、表单和状态模式可以适配给真实 Kokoro 功能。
- Clerk 与演示认证状态由 Auth.js 和版本化认证契约替代。
- Vite、TanStack Router 和 Demo 数据不得作为生产运行路径。
- shadcn/ui 原语继续通过官方 Registry 管理；上游组合模式不得分叉出第二套原语层。
- 任何偏离上游布局或组件职责的变化都必须由 Next.js、Auth.js、Kokoro API、可访问性或安全边界解释。

## 证据要求

完成状态至少需要：

1. 上游来源、提交和 MIT 许可证可追溯。
2. Sidebar、Header、DataTable、Dialog、Sheet、表单、主题、响应式和可访问性均有对应实现。
3. 生产导航不存在模板示例业务。
4. 依赖和源码扫描不存在 Ant Design、ProComponents、Clerk 或 Vite 生产运行时。
5. 桌面与移动端可见浏览器截图证明布局和交互，而非仅凭源文件名判断已迁入。
