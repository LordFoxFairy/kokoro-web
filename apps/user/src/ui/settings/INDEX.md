---
architectureIndex: 1
rootId: web.user.ui.settings
owners:
  - "@LordFoxFairy"
---

# ui/settings — 用户设置中心（模态）

## 职责
登录后的设置中心（WEB-FACE 面三），与管理后台严格分离。**浮在工作区之上的模态卡片面板**（通用 `@/ui/common/Modal`），非整页路由——打开不导航离开、语境原地保留，关闭走背幕/Esc/右上 ×。左 tab 竖导航统一 8 分区（账户 / 外观与语言 / 对话偏好 / 订阅与余额 / 技能 / 连接 / 作品 / 团队），右内容区一次显一个 tab。开关态由 shell 持有并同步 URL `?settings=X`（刷新/深链/可分享）；`/settings?tab=X` 旧深链在路由层薄重定向到 `/?settings=X`。皮肤守 --k-* token，亮暗双态。

## 公开件
- `SettingsModal`（`settings-modal.tsx`）：props `brandName?` / `initialTab`(SettingsTab) / `onClose` / `onTabChange?`。客户端组件；tab 内部自持（`initialTab` 定初值、变化即重置，`onTabChange` 上抛供 shell 同步 URL）。**不自持匿名闸**——只在 `SessionShell`（信封有效）内渲染，会话态由上游保证。
- `SettingsTab` / `SETTINGS_TABS` / `normalizeSettingsTab`（`settings-modal.tsx`）：tab 键类型与 URL 值归一（shell/rail 复用）。
- `chat-prefs.ts`：对话偏好本地 store（localStorage `kokoro.web.chat-prefs`）。`readChatModel`/`readChatAgent`/`writeChatModel`/`writeChatAgent`；null=跟随空间缺省（不上 wire）。

## 协作者
上游：`@/ui/shell/session-shell`（持模态开关态 + `?settings=` URL 同步，rail 入口/错误恢复卡触发 `openSettings`）。深链兜底 `@/app/settings/page.tsx`（薄重定向到 `/?settings=X`）。下游：`@/ui/common/Modal`（浮层壳）、`@/ui/theme`（主题）、`@/i18n`（语言 + settings.* 文案）、`@/ui/shell/page-clients`（team/billing/list 客户端）、`@/billing/format`。
`chat-prefs` 被 `@/ui/shell/use-composer-selectors` 读作选择器初值（新对话首帧预填，会话级锁语义不变）。

## 陷阱
- 诚实态：无客户端 email 来源（信封仅 user_id/namespace/site_id），不造假 email 行；无密码/API key 机制，不造对应卡。
- 账户卡当前团队由 `currentNamespace()` + `listMyTeams()` 解析名；预览/无信封显“预览模式”。
- 技能/连接/作品/团队/账单/定价内容从原独立弹窗剥离为 `XxxContent`（`@/ui/skills`、`@/ui/mcp`、`@/ui/library`、`@/ui/team`、`@/ui/billing`），设置中心右区直接嵌入。团队切换走整页 reload；作品跳源会话经共享引擎 `openConversation` + 关模态（模态本就浮在 `/` 之上，无需再导航）。
- `settings-sections.tsx`（账户/外观/对话/订阅卡）+ `settings-page.module.css`（sections 卡片/行/segment/select 皮肤）；账户/外观/对话为 sections，订阅=`BillingContent`+`PricingContent`。模态内两栏布局在 `settings-modal.module.css`。
