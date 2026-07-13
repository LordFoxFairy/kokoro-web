// 团队面板组件测试（TEAM-1）：切换器高亮当前 + 切换触发换签回调；待处理邀请 accept/decline；
// owner 邀请/移除成员；last_owner 错误反射本地化提示。团队客户端为注入 fake（不打网络）。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocaleProvider } from "@/i18n/context"
import { TeamClientError, type TeamClient, type TeamDetail, type TeamSummary } from "@/team/client"
import { TeamPanel } from "@/ui/team/team-panel"

const TEAMS: TeamSummary[] = [
  { team: { id: "t-personal", name: "Personal", type: "personal" }, membership: { role: "owner" } },
  { team: { id: "t-acme", name: "Acme", type: "team" }, membership: { role: "member" } },
]

const OWNER_DETAIL: TeamDetail = {
  team: { id: "t-personal", name: "Personal", type: "personal" },
  viewerRole: "owner",
  members: [
    { userId: "u-me", email: "me@example.com", displayName: "Me", role: "owner", status: "active", joinedAt: "2026-07-13T00:00:00.000Z" },
    { userId: "u-bob", email: "bob@example.com", displayName: "Bob", role: "member", status: "active", joinedAt: "2026-07-13T00:00:00.000Z" },
  ],
  invites: [],
}

function makeClient(overrides: Partial<TeamClient> = {}): TeamClient {
  return {
    currentNamespace: vi.fn().mockResolvedValue("t-personal"),
    listMyTeams: vi.fn().mockResolvedValue(TEAMS),
    listInvites: vi.fn().mockResolvedValue([]),
    teamDetail: vi.fn().mockResolvedValue(OWNER_DETAIL),
    createInvite: vi.fn().mockResolvedValue(undefined),
    acceptInvite: vi.fn().mockResolvedValue(undefined),
    declineInvite: vi.fn().mockResolvedValue(undefined),
    changeRole: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
    switchTeam: vi.fn().mockResolvedValue("t-acme"),
    ...overrides,
  }
}

function renderPanel(client: TeamClient, onSwitched = vi.fn(), onClose = vi.fn(), currentNamespace = "t-personal") {
  return render(
    <TeamPanel client={client} currentNamespace={currentNamespace} onClose={onClose} onSwitched={onSwitched} />,
    { wrapper: LocaleProvider },
  )
}

afterEach(cleanup)

describe("TeamPanel", () => {
  it("highlights the current team and switches to another", async () => {
    const client = makeClient()
    const onSwitched = vi.fn()
    renderPanel(client, onSwitched)

    const current = await screen.findByTestId("team-switch-t-personal")
    expect(current.getAttribute("data-active")).toBe("true")
    expect((current as HTMLButtonElement).disabled).toBe(true)

    const other = screen.getByTestId("team-switch-t-acme")
    expect(other.getAttribute("data-active")).toBe("false")
    fireEvent.click(other)

    await waitFor(() => expect(client.switchTeam).toHaveBeenCalledWith("t-acme"))
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith("t-acme"))
  })

  it("accepts a pending invite and reloads", async () => {
    const client = makeClient({
      listInvites: vi
        .fn()
        .mockResolvedValueOnce([
          { id: "inv-1", teamId: "t-acme", teamName: "Acme", role: "member", expiresAt: "x", createdAt: "y" },
        ])
        .mockResolvedValue([]),
    })
    renderPanel(client)

    fireEvent.click(await screen.findByTestId("invite-accept"))
    await waitFor(() => expect(client.acceptInvite).toHaveBeenCalledWith("inv-1"))
    // 接受后重取清单/详情。
    await waitFor(() => expect((client.listMyTeams as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1))
  })

  it("lets an owner invite and remove members", async () => {
    const client = makeClient()
    renderPanel(client)

    await screen.findByTestId("team-members")
    fireEvent.change(screen.getByTestId("invite-email"), { target: { value: "new@example.com" } })
    fireEvent.click(screen.getByTestId("invite-submit"))
    await waitFor(() =>
      expect(client.createInvite).toHaveBeenCalledWith("t-personal", "new@example.com", "member"),
    )

    fireEvent.click(screen.getByTestId("member-remove-u-bob"))
    await waitFor(() => expect(client.removeMember).toHaveBeenCalledWith("t-personal", "u-bob"))
  })

  it("surfaces the last-owner guard as a localized notice", async () => {
    const client = makeClient({
      removeMember: vi
        .fn()
        .mockRejectedValue(new TeamClientError("last owner", "membership.last_owner", 409)),
    })
    renderPanel(client)

    fireEvent.click(await screen.findByTestId("member-remove-u-me"))
    const notice = await screen.findByTestId("team-notice")
    expect(notice.textContent && notice.textContent.length > 0).toBe(true)
  })

  it("shows a read-only hint for plain members", async () => {
    const client = makeClient({
      teamDetail: vi.fn().mockResolvedValue({ ...OWNER_DETAIL, viewerRole: "member" }),
    })
    renderPanel(client)

    await screen.findByTestId("team-members")
    // member 视图无邀请表单。
    expect(screen.queryByTestId("invite-submit")).toBeNull()
  })
})
