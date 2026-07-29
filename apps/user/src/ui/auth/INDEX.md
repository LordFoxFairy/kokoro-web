---
architectureIndex: 1
rootId: web.user.ui.auth
owners:
  - "@LordFoxFairy"
---

# ui/auth — 登录与会话态门面

## 职责
会话态探针 + 首页分流 + 登录页面板（AUTH-P0 / WEB-FACE 面一·面二）。鉴权由 httpOnly 信封 cookie 同源携带，前端不持 token。

## 公开件
- `useSessionState`（`use-session-state.ts`）：探 `/api/auth/session-state` → `"checking"|"pass"|"anonymous"`；authenticated/preview=pass，探针失败=pass（fail-open 预览档）。
- `HomeGate`（`home-gate.tsx`）：`/` 客户端分流——pass 渲染 `SessionShell`，anonymous 渲染 `LandingPage`，checking 渲染空白。props `brandName?`。
- `PasswordLogin`（`password-login.tsx`）：`/login` 的 email/password 与 TOTP/recovery-code 登录表单；先持久化 one-time command，再交 NextAuth Credentials provider 调 Platform Public Identity。

## 协作者
上游：`@/app/login/page.tsx`（PasswordLogin）、`@/ui/settings`（useSessionState 匿名闸）。下游：Auth.js Credentials BFF、Platform Public Identity、`@/ui/marketing`。

## 陷阱
- 浏览器只持有 Site-local httpOnly 加密会话 cookie。登录/MFA/刷新遇到 delivery unavailable 时，以同一 prior receipt capability 创建 superseding command，不向浏览器暴露任何 Platform credential。
- 诚实态：不放假 OAuth 按钮；错误 toast 归一，不在表单内联报错。
