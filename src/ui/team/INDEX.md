# ui/team — 团队面板

## 职责
团队切换器（当前 namespace 高亮）+ 待处理邀请（accept/decline）+ 当前团队成员管理（邀请/改角色/移除）。

## 公开件
- `TeamPanel`（`team-panel.tsx`）：props `client: TeamClient` / `currentNamespace` / `onClose` / `onSwitched`。

## 协作者
- `@/team/client`（纯请求，含 `switchTeam` 专用 re-seal 路由）、`@/team/permissions`（`canManageMembers` / `canAssignRoles`）。
- `@/lib/query`：teams/invites/detail 三读走 `useResource`（键 `team/teams`、`team/invites`、`team/detail/<ns>`）；变更后按前缀失活。

## 陷阱
- 切换 → BFF 换签重密封 cookie → 整页刷新（`onSwitched`），rail/技能/余额随 namespace 天然重水合。
- 权限判定仅决定控件可见性，真正越权由后端拒绝；user principal 全留服务端。
- detail 按 namespace 分键；无信封/预览（null）时取数即抛，落 error 态。
