// 团队成员管理权限判定（纯规则，零 React 零 I/O）：viewer 角色 → 能否管理成员 / 能否改派角色。
// UI 只消费这些谓词，不在组件内散写角色比较。权威身份/角色由服务端信封解析，前端只据 viewerRole 决定
// 控件可见性（真正的越权由后端拒绝，前端判定仅为体验）。

import type { TeamRole } from "./client"

// 可管理成员（邀请 / 移除成员）：owner 与 admin。
export function canManageMembers(role: TeamRole): boolean {
  return role === "owner" || role === "admin"
}

// 可改派成员角色（含升降 owner）：仅 owner。
export function canAssignRoles(role: TeamRole): boolean {
  return role === "owner"
}
