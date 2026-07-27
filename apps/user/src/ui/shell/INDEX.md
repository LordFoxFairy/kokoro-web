---
architectureIndex: 1
rootId: web.user.ui.shell
owners:
  - "@LordFoxFairy"
---

# ui/shell — 页面装配层

## 职责
持有页面级引擎单例，订阅快照，把纯投影接线到各 UI 域。本层只做插槽接线；域内状态一律下沉到 controller。

## 公开件
- `SessionShell`（`session-shell.tsx`）：唯一页面入口组件；props `engine?`（测试注入缝）/ `brandName`。
- `page-clients.ts`：页面级单例客户端/引擎（`browserEngine` / `browserListClient` / `browserHubClient` / `browserBillingClient` / `browserPricingClient` / `browserTeamClient`）。仅浏览器构造，SSR 为 null。
- 域 controller hooks（各自持查询/store/回调）：`useComposerSelectors` / `usePinnedSkills`(+`togglePinned`/`removePinned`) / `useDraft` / `useConversationList` / `useAwaitingNotify` / `useCanvasWorkspace`。
- `HeaderTitle`：会话头部可改标题。

## 协作者
上游：`@/engine`（引擎/快照）。下游：composer/thread/rail/canvas/hitl 各域组件、四大面板、`@/lib/query`、各外部 store。

## 陷阱
- shell 是插槽接线：新增域状态放对应 controller hook，不要塞回 shell。
- page-clients 是浏览器单例：SSR/未水合返回 null/惰性，取数 effect 依赖其稳定引用。
- 鉴权由 httpOnly 信封 cookie 同源携带，前端不持 token。
- 管理面板（技能/连接/作品/团队/账单/定价）统一到设置中心模态（`@/ui/settings` `SettingsModal`，浮在工作区之上）；`SessionShell` 持模态开关态 `settingsTab` 并同步 URL `?settings=X`（`window.location`+`history.replaceState`，**不用 `useSearchParams`**——免 Suspense 边界/不动测试 mock）。rail 各入口 + 错误恢复卡（余额/套餐）改调 `openSettings(tab)`，不再整页 `router.push`。
- `useComposerSelectors` 的模型/agent 初值取 `@/ui/settings/chat-prefs` 缺省偏好——新对话首帧预填，开跑后 modeLocked 锁定，会话级锁语义不变。
