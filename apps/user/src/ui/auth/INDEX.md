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
- `LoginPanel`（`login-panel.tsx`）：`/login` 登录卡（暖纸皮肤，无 antd）。email → magic-link；发送后态含重发倒计时 + 改邮箱；错误走顶部 toast（不内联）；OAuth 为不渲染插槽（无假按钮）；保留 dev 可点链。props `brandName?`。

## 协作者
上游：`@/app/page.tsx`（HomeGate）、`@/app/login/page.tsx`（LoginPanel）、`@/ui/settings`（useSessionState 匿名闸）。下游：`@/api/auth/*` BFF、`@/i18n`（auth.* 文案）、`@/ui/marketing`、`@/ui/shell`。

## 陷阱
- 登录机制零改动：只 POST `/api/auth/magic-link/request`，换会话在 `/api/auth/callback`（密封 cookie + 303 回 `/`）。callback 失败 303 到 `/?auth=link_unavailable`，由 LandingPage 转投 `/login`（LoginPanel 承载 toast）。
- 诚实态：不放假 OAuth 按钮；错误 toast 归一，不在表单内联报错。
