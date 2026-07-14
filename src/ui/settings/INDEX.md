# ui/settings — 用户设置页

## 职责
登录后的 `/settings` 用户设置页（WEB-FACE 面三），与管理后台严格分离。纵向五卡：账户 / 外观与语言 / 对话偏好 / 订阅与余额 / 能力入口。皮肤守 Kokoro 暖纸 --k-* token，亮暗双态。

## 公开件
- `SettingsPage`（`settings-page.tsx`）：props `brandName?`。客户端组件；内含匿名闸（`useSessionState` 匿名 → `router.replace("/login")`）。
- `chat-prefs.ts`：对话偏好本地 store（localStorage `kokoro.web.chat-prefs`）。`readChatModel`/`readChatAgent`/`writeChatModel`/`writeChatAgent`；null=跟随空间缺省（不上 wire）。

## 协作者
上游：`@/app/settings/page.tsx`（服务端解析品牌后渲染）。下游：`@/ui/theme`（主题）、`@/i18n`（语言 + settings.* 文案）、`@/ui/shell/page-clients`（team/billing/list 客户端）、`@/billing/format`。
`chat-prefs` 被 `@/ui/shell/use-composer-selectors` 读作选择器初值（新对话首帧预填，会话级锁语义不变）。

## 陷阱
- 诚实态：无客户端 email 来源（信封仅 user_id/namespace/site_id），不造假 email 行；无密码/API key 机制，不造对应卡。
- 账户卡当前团队由 `currentNamespace()` + `listMyTeams()` 解析名；预览/无信封显“预览模式”。
- 能力入口/切换团队/查看流水价格页均以 `/?panel=<name>` 深链回工作台（面板同源，不重复实现）。深链由 `use-overlay-panels` 懒派生打开。
