"use client"

// 团队面板（TEAM-1）：团队切换器（当前 namespace 高亮，切换→BFF 换签→重密封 cookie→整页刷新，
// Wave3 rail/技能/余额随 namespace 天然重水合）+ 待处理邀请（accept/decline）+ 当前团队成员管理
// （owner/admin 邀请/改角色/移除；member 只读）。user principal 全留服务端，前端只见同源 `/api/team/*`。

import { useCallback, useEffect, useState } from "react"

import { useT } from "@/i18n/context"
import {
  TeamClientError,
  type Member,
  type PendingInvite,
  type TeamClient,
  type TeamDetail,
  type TeamRole,
  type TeamSummary,
} from "@/team/client"

import styles from "./team-panel.module.css"

type TeamsState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; teams: TeamSummary[] }

type DetailState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; detail: TeamDetail }

type TeamPanelProps = {
  client: TeamClient
  currentNamespace: string | null
  onClose: () => void
  // 换签成功回调：由外壳整页刷新，令三竖切按新 namespace 重水合。
  onSwitched: (namespace: string) => void
}

type TeamErrorKey =
  | "team.errLastOwner"
  | "team.errInviteExpired"
  | "team.errInviteStale"
  | "team.errForbidden"
  | "team.errGeneric"

// user 稳定错误码 → 本地化文案 key；未知码回退通用失败。
function errorKey(error: unknown): TeamErrorKey {
  const code = error instanceof TeamClientError ? error.code : null
  switch (code) {
    case "membership.last_owner":
      return "team.errLastOwner"
    case "invite.expired":
      return "team.errInviteExpired"
    case "invite.not_pending":
      return "team.errInviteStale"
    case "invite.forbidden":
    case "team.forbidden":
      return "team.errForbidden"
    default:
      return "team.errGeneric"
  }
}

export function TeamPanel({ client, currentNamespace, onClose, onSwitched }: TeamPanelProps) {
  const t = useT()
  const [teams, setTeams] = useState<TeamsState>({ kind: "loading" })
  const [invites, setInvites] = useState<PendingInvite[]>([])
  const [detail, setDetail] = useState<DetailState>({ kind: "loading" })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 纯取数（不 setState）：结果态回给调用方。挂载 effect 用 .then(setState)（async 回调，
  // 无同步级联渲染，对齐 skills-panel 惯用法）；事件回调里另包 reload 包装直接 setState。
  const fetchTeams = useCallback(async (): Promise<TeamsState> => {
    try {
      return { kind: "ready", teams: await client.listMyTeams() }
    } catch {
      return { kind: "error" }
    }
  }, [client])

  const fetchInvites = useCallback(async (): Promise<PendingInvite[]> => {
    try {
      return await client.listInvites()
    } catch {
      return []
    }
  }, [client])

  const fetchDetail = useCallback(async (): Promise<DetailState> => {
    if (currentNamespace === null) {
      return { kind: "error" }
    }
    try {
      return { kind: "ready", detail: await client.teamDetail(currentNamespace) }
    } catch {
      return { kind: "error" }
    }
  }, [client, currentNamespace])

  const loadTeams = useCallback(async () => setTeams(await fetchTeams()), [fetchTeams])
  const loadInvites = useCallback(async () => setInvites(await fetchInvites()), [fetchInvites])
  const loadDetail = useCallback(async () => setDetail(await fetchDetail()), [fetchDetail])

  useEffect(() => {
    void fetchTeams().then(setTeams)
    void fetchInvites().then(setInvites)
    void fetchDetail().then(setDetail)
  }, [fetchTeams, fetchInvites, fetchDetail])

  const onSwitch = useCallback(
    async (teamId: string) => {
      setBusy(`switch:${teamId}`)
      setNotice(null)
      try {
        const namespace = await client.switchTeam(teamId)
        onSwitched(namespace)
      } catch (error) {
        setNotice(t(errorKey(error)))
        setBusy(null)
      }
    },
    [client, onSwitched, t],
  )

  const onAccept = useCallback(
    async (inviteId: string) => {
      setBusy(`accept:${inviteId}`)
      setNotice(null)
      try {
        await client.acceptInvite(inviteId)
        await Promise.all([loadTeams(), loadInvites(), loadDetail()])
      } catch (error) {
        setNotice(t(errorKey(error)))
      } finally {
        setBusy(null)
      }
    },
    [client, loadTeams, loadInvites, loadDetail, t],
  )

  const onDecline = useCallback(
    async (inviteId: string) => {
      setBusy(`decline:${inviteId}`)
      setNotice(null)
      try {
        await client.declineInvite(inviteId)
        await loadInvites()
      } catch (error) {
        setNotice(t(errorKey(error)))
      } finally {
        setBusy(null)
      }
    },
    [client, loadInvites, t],
  )

  const afterMemberMutation = useCallback(async () => {
    await Promise.all([loadDetail(), loadTeams()])
  }, [loadDetail, loadTeams])

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("team.title")}
        className={styles.panel}
        data-testid="team-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>{t("team.title")}</h2>
            <p className={styles.subtitle}>{t("team.subtitle")}</p>
          </div>
          <button type="button" className={styles.close} aria-label={t("team.close")} onClick={onClose}>
            ×
          </button>
        </header>

        <div className={styles.body}>
          {notice ? (
            <p className={styles.notice} role="alert" data-testid="team-notice">
              {notice}
            </p>
          ) : null}

          <SwitcherSection
            teams={teams}
            currentNamespace={currentNamespace}
            busy={busy}
            onRetry={loadTeams}
            onSwitch={onSwitch}
          />

          {invites.length > 0 ? (
            <section className={styles.section} data-testid="team-invites">
              <h3 className={styles.sectionTitle}>{t("team.invitesTitle")}</h3>
              <ul className={styles.list}>
                {invites.map((invite) => (
                  <InviteRow
                    key={invite.id}
                    invite={invite}
                    busy={busy}
                    onAccept={onAccept}
                    onDecline={onDecline}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <MembersSection
            client={client}
            detail={detail}
            busy={busy}
            setBusy={setBusy}
            onError={(error) => setNotice(t(errorKey(error)))}
            onMutated={afterMemberMutation}
            onRetry={loadDetail}
          />
        </div>
      </div>
    </div>
  )
}

function SwitcherSection({
  teams,
  currentNamespace,
  busy,
  onRetry,
  onSwitch,
}: {
  teams: TeamsState
  currentNamespace: string | null
  busy: string | null
  onRetry: () => void
  onSwitch: (teamId: string) => void
}) {
  const t = useT()
  return (
    <section className={styles.section} data-testid="team-switcher">
      <h3 className={styles.sectionTitle}>{t("team.switcherTitle")}</h3>
      {teams.kind === "loading" ? (
        <p className={styles.hint}>{t("team.loading")}</p>
      ) : teams.kind === "error" ? (
        <div className={styles.hint}>
          <p>{t("team.loadError")}</p>
          <button type="button" className={styles.retry} onClick={onRetry}>
            {t("team.retry")}
          </button>
        </div>
      ) : (
        <ul className={styles.teamList}>
          {teams.teams.map((summary) => {
            const isCurrent = summary.team.id === currentNamespace
            const switching = busy === `switch:${summary.team.id}`
            return (
              <li key={summary.team.id}>
                <button
                  type="button"
                  className={styles.teamItem}
                  data-active={isCurrent}
                  data-testid={`team-switch-${summary.team.id}`}
                  disabled={isCurrent || switching || busy !== null}
                  aria-current={isCurrent ? "true" : undefined}
                  onClick={() => onSwitch(summary.team.id)}
                >
                  <span className={styles.teamName}>
                    {teamLabel(summary.team.type, summary.membership.role, summary.team.name, t)}
                  </span>
                  <span className={styles.teamMeta}>
                    <span className={styles.roleBadge} data-role={summary.membership.role}>
                      {t(roleKey(summary.membership.role))}
                    </span>
                    {isCurrent ? <span className={styles.currentTag}>{t("team.current")}</span> : null}
                    {switching ? <span className={styles.currentTag}>{t("team.switching")}</span> : null}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function InviteRow({
  invite,
  busy,
  onAccept,
  onDecline,
}: {
  invite: PendingInvite
  busy: string | null
  onAccept: (id: string) => void
  onDecline: (id: string) => void
}) {
  const t = useT()
  const working = busy === `accept:${invite.id}` || busy === `decline:${invite.id}`
  return (
    <li className={styles.item} data-testid="invite-row">
      <div className={styles.itemMain}>
        <span className={styles.name}>{invite.teamName}</span>
        <span className={styles.roleBadge} data-role={invite.role}>
          {t(roleKey(invite.role))}
        </span>
      </div>
      <div className={styles.itemActions}>
        <button
          type="button"
          className={styles.primaryBtn}
          data-testid="invite-accept"
          disabled={working || busy !== null}
          onClick={() => onAccept(invite.id)}
        >
          {t("team.accept")}
        </button>
        <button
          type="button"
          className={styles.ghostBtn}
          data-testid="invite-decline"
          disabled={working || busy !== null}
          onClick={() => onDecline(invite.id)}
        >
          {t("team.decline")}
        </button>
      </div>
    </li>
  )
}

function MembersSection({
  client,
  detail,
  busy,
  setBusy,
  onError,
  onMutated,
  onRetry,
}: {
  client: TeamClient
  detail: DetailState
  busy: string | null
  setBusy: (value: string | null) => void
  onError: (error: unknown) => void
  onMutated: () => Promise<void>
  onRetry: () => void
}) {
  const t = useT()
  if (detail.kind === "loading") {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("team.membersTitle")}</h3>
        <p className={styles.hint}>{t("team.loading")}</p>
      </section>
    )
  }
  if (detail.kind === "error") {
    return (
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t("team.membersTitle")}</h3>
        <div className={styles.hint}>
          <p>{t("team.membersError")}</p>
          <button type="button" className={styles.retry} onClick={onRetry}>
            {t("team.retry")}
          </button>
        </div>
      </section>
    )
  }

  const { team, viewerRole, members, invites } = detail.detail
  const canManage = viewerRole === "owner" || viewerRole === "admin"
  const isOwner = viewerRole === "owner"

  return (
    <section className={styles.section} data-testid="team-members">
      <div className={styles.sectionRow}>
        <h3 className={styles.sectionTitle}>{teamLabel(team.type, viewerRole, team.name, t)}</h3>
        <span className={styles.roleBadge} data-role={viewerRole}>
          {t(roleKey(viewerRole))}
        </span>
      </div>

      {canManage ? (
        <InviteForm
          client={client}
          teamId={team.id}
          busy={busy}
          setBusy={setBusy}
          onError={onError}
          onInvited={onMutated}
        />
      ) : (
        <p className={styles.hint}>{t("team.memberReadonly")}</p>
      )}

      <ul className={styles.list}>
        {members.map((member) => (
          <MemberRow
            key={member.userId}
            client={client}
            teamId={team.id}
            member={member}
            isOwner={isOwner}
            canManage={canManage}
            busy={busy}
            setBusy={setBusy}
            onError={onError}
            onMutated={onMutated}
          />
        ))}
      </ul>

      {canManage && invites.length > 0 ? (
        <div className={styles.pending} data-testid="team-pending-invites">
          <p className={styles.pendingLabel}>{t("team.pendingLabel")}</p>
          <ul className={styles.list}>
            {invites.map((invite) => (
              <li key={invite.id} className={styles.pendingRow}>
                <span className={styles.name}>{invite.email}</span>
                <span className={styles.roleBadge} data-role={invite.role}>
                  {t(roleKey(invite.role))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

function InviteForm({
  client,
  teamId,
  busy,
  setBusy,
  onError,
  onInvited,
}: {
  client: TeamClient
  teamId: string
  busy: string | null
  setBusy: (value: string | null) => void
  onError: (error: unknown) => void
  onInvited: () => Promise<void>
}) {
  const t = useT()
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<"admin" | "member">("member")
  const submitting = busy === "invite"

  const submit = useCallback(async () => {
    const trimmed = email.trim()
    if (trimmed.length === 0) {
      return
    }
    setBusy("invite")
    try {
      await client.createInvite(teamId, trimmed, role)
      setEmail("")
      await onInvited()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(null)
    }
  }, [client, teamId, email, role, onInvited, onError, setBusy])

  return (
    <form
      className={styles.inviteForm}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <input
        type="email"
        className={styles.inviteInput}
        placeholder={t("team.invitePlaceholder")}
        aria-label={t("team.inviteEmailAria")}
        data-testid="invite-email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <select
        className={styles.roleSelect}
        aria-label={t("team.inviteRoleAria")}
        data-testid="invite-role"
        value={role}
        onChange={(e) => setRole(e.target.value === "admin" ? "admin" : "member")}
      >
        <option value="member">{t("team.roleMember")}</option>
        <option value="admin">{t("team.roleAdmin")}</option>
      </select>
      <button
        type="submit"
        className={styles.primaryBtn}
        data-testid="invite-submit"
        disabled={submitting || busy !== null || email.trim().length === 0}
      >
        {submitting ? t("team.inviting") : t("team.invite")}
      </button>
    </form>
  )
}

function MemberRow({
  client,
  teamId,
  member,
  isOwner,
  canManage,
  busy,
  setBusy,
  onError,
  onMutated,
}: {
  client: TeamClient
  teamId: string
  member: Member
  isOwner: boolean
  canManage: boolean
  busy: string | null
  setBusy: (value: string | null) => void
  onError: (error: unknown) => void
  onMutated: () => Promise<void>
}) {
  const t = useT()
  const rowBusy = busy === `member:${member.userId}`

  const changeRole = useCallback(
    async (role: TeamRole) => {
      if (role === member.role) {
        return
      }
      setBusy(`member:${member.userId}`)
      try {
        await client.changeRole(teamId, member.userId, role)
        await onMutated()
      } catch (error) {
        onError(error)
      } finally {
        setBusy(null)
      }
    },
    [client, teamId, member.userId, member.role, onMutated, onError, setBusy],
  )

  const remove = useCallback(async () => {
    setBusy(`member:${member.userId}`)
    try {
      await client.removeMember(teamId, member.userId)
      await onMutated()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(null)
    }
  }, [client, teamId, member.userId, onMutated, onError, setBusy])

  return (
    <li className={styles.item} data-testid="member-row">
      <div className={styles.itemMain}>
        <span className={styles.name}>{member.displayName || member.email || member.userId}</span>
        {member.email ? <span className={styles.subtle}>{member.email}</span> : null}
      </div>
      <div className={styles.itemActions}>
        {/* 改角色仅 owner；member 视图无控件（只读）。 */}
        {isOwner ? (
          <select
            className={styles.roleSelect}
            aria-label={t("team.changeRoleAria")}
            data-testid={`member-role-${member.userId}`}
            value={member.role}
            disabled={rowBusy || busy !== null}
            onChange={(e) => void changeRole(e.target.value as TeamRole)}
          >
            <option value="owner">{t("team.roleOwner")}</option>
            <option value="admin">{t("team.roleAdmin")}</option>
            <option value="member">{t("team.roleMember")}</option>
          </select>
        ) : (
          <span className={styles.roleBadge} data-role={member.role}>
            {t(roleKey(member.role))}
          </span>
        )}
        {canManage ? (
          <button
            type="button"
            className={styles.dangerBtn}
            data-testid={`member-remove-${member.userId}`}
            disabled={rowBusy || busy !== null}
            onClick={() => void remove()}
          >
            {t("team.remove")}
          </button>
        ) : null}
      </div>
    </li>
  )
}

// 团队名：自己拥有的个人空间显示「个人空间」；他人的个人团队/普通团队一律显示真实名。
function teamLabel(
  type: "personal" | "team",
  role: TeamRole,
  name: string,
  t: (key: "team.personalName") => string,
): string {
  return type === "personal" && role === "owner" ? t("team.personalName") : name
}

function roleKey(role: TeamRole): "team.roleOwner" | "team.roleAdmin" | "team.roleMember" {
  if (role === "owner") return "team.roleOwner"
  if (role === "admin") return "team.roleAdmin"
  return "team.roleMember"
}
