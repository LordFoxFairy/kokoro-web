# ui/marketing — 营销落地页

## 职责
未登录访客的 `/` 首页（WEB-FACE 面一）。结构=顶栏/Hero/能力交替/FAQ/深色CTA/多列页脚；皮肤守 Kokoro 暖纸 --k-* token，亮暗双态。

## 公开件
- `LandingPage`（`landing-page.tsx`）：props `brandName?`（SITE-REAL 注入，缺省回退 Kokoro）。客户端组件。

## 协作者
上游：`@/ui/auth/home-gate`（会话态匿名分支渲染本页）。下游：`@/i18n`（marketing.* 文案）、`@/ui/shell/use-draft`（`stashPendingDraft` 带入 composer）、`next/link`·`next/navigation`。

## 陷阱
- 诚实态：能力区用抽象几何插画位，不放假产品截图；页脚只挂真实目的地（页内锚 + /login），不造假路由。
- hero 输入回车/点开始 → 暂存 pending 草稿 → 跳 /login；登录回跳 `/` 后工作台 composer 读同键预填。
- 回调失败 `?auth=link_unavailable` 落 `/` 时本页转投 `/login`（callback 机制不改），错误 UI 由登录页承载。
- 页面路由内链一律 `next/link`（`/`、`/login`），页内锚用 `<a href="#…">`。
