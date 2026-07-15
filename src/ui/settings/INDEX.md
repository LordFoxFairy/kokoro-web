# ui/settings — 用户设置页

## 职责
登录后的 `/settings` 全屏设置中心（WEB-FACE 面三），与管理后台严格分离。左 tab 竖导航统一 8 分区（账户 / 外观与语言 / 对话偏好 / 订阅与余额 / 技能 / 连接 / 作品 / 团队），右内容区一次显一个 tab，URL `?tab=X` 驱动（刷新/深链保持）。rail 各管理入口都跳对应 tab，不再开任何独立弹窗。皮肤守 --k-* token，亮暗双态。

## 公开件
- `SettingsPage`（`settings-page.tsx`）：props `brandName?`。客户端组件；内含匿名闸（`useSessionState` 匿名 → `router.replace("/login")`）。
- `chat-prefs.ts`：对话偏好本地 store（localStorage `kokoro.web.chat-prefs`）。`readChatModel`/`readChatAgent`/`writeChatModel`/`writeChatAgent`；null=跟随空间缺省（不上 wire）。

## 协作者
上游：`@/app/settings/page.tsx`（服务端解析品牌后渲染）。下游：`@/ui/theme`（主题）、`@/i18n`（语言 + settings.* 文案）、`@/ui/shell/page-clients`（team/billing/list 客户端）、`@/billing/format`。
`chat-prefs` 被 `@/ui/shell/use-composer-selectors` 读作选择器初值（新对话首帧预填，会话级锁语义不变）。

## 陷阱
- 诚实态：无客户端 email 来源（信封仅 user_id/namespace/site_id），不造假 email 行；无密码/API key 机制，不造对应卡。
- 账户卡当前团队由 `currentNamespace()` + `listMyTeams()` 解析名；预览/无信封显“预览模式”。
- 技能/连接/作品/团队/账单/定价内容从原独立弹窗剥离为 `XxxContent`（`@/ui/skills`、`@/ui/mcp`、`@/ui/library`、`@/ui/team`、`@/ui/billing`），设置中心右区直接嵌入，不再跳弹窗。团队切换走整页 reload；作品跳源会话经共享引擎 `openConversation` + 回工作台。
- `settings-sections.tsx`（账户/外观/对话/订阅卡）+ `settings-center.module.css`（全屏 tab 布局）；账户/外观/对话为 sections，订阅=`BillingContent`+`PricingContent`。
