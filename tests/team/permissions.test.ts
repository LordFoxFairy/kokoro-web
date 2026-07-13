// 团队权限规则：管理成员=owner/admin；改派角色=仅 owner。
import { describe, expect, it } from "vitest"

import { canAssignRoles, canManageMembers } from "@/team/permissions"

describe("team permissions", () => {
  it("canManageMembers: owner 与 admin 可，member 不可", () => {
    expect(canManageMembers("owner")).toBe(true)
    expect(canManageMembers("admin")).toBe(true)
    expect(canManageMembers("member")).toBe(false)
  })

  it("canAssignRoles: 仅 owner 可", () => {
    expect(canAssignRoles("owner")).toBe(true)
    expect(canAssignRoles("admin")).toBe(false)
    expect(canAssignRoles("member")).toBe(false)
  })
})
