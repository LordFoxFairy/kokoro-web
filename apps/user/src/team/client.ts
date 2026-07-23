// 团队自助面 HTTP 客户端：同源 `/api/team/*` BFF 代理（注入 web-bff 凭据 + 信封 user principal）。
// 换签走 `/api/team/switch`（服务端重密封 cookie，token 不回浏览器）。入站过 Zod；错误尽力取
// user 稳定错误码（如 membership.last_owner / invite.expired）供 UI 本地化。

import { z, type ZodTypeAny } from "zod"

export type TeamRole = "owner" | "admin" | "member"

const dataEnvelope = <T extends ZodTypeAny>(inner: T) => z.object({ data: inner })
const errorEnvelope = z.object({ error: z.object({ code: z.string(), message: z.string() }) })

export const teamSummarySchema = z.object({
  team: z.object({ id: z.string(), name: z.string(), type: z.enum(["personal", "team"]) }).passthrough(),
  membership: z.object({ role: z.enum(["owner", "admin", "member"]) }).passthrough(),
})
export type TeamSummary = z.infer<typeof teamSummarySchema>

export const pendingInviteSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  teamName: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type PendingInvite = z.infer<typeof pendingInviteSchema>

export const memberSchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  displayName: z.string().nullable(),
  role: z.enum(["owner", "admin", "member"]),
  status: z.enum(["active", "disabled"]),
  joinedAt: z.string(),
})
export type Member = z.infer<typeof memberSchema>

export const teamInviteSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  status: z.enum(["pending", "accepted", "revoked", "expired"]),
  expiresAt: z.string(),
  createdAt: z.string(),
})
export type TeamInvite = z.infer<typeof teamInviteSchema>

export const teamDetailSchema = z.object({
  team: z.object({ id: z.string(), name: z.string(), type: z.enum(["personal", "team"]) }).passthrough(),
  viewerRole: z.enum(["owner", "admin", "member"]),
  members: z.array(memberSchema),
  invites: z.array(teamInviteSchema),
})
export type TeamDetail = z.infer<typeof teamDetailSchema>

export class TeamClientError extends Error {
  readonly code: string | null
  readonly status: number | null
  constructor(message: string, code: string | null, status: number | null) {
    super(message)
    this.name = "TeamClientError"
    this.code = code
    this.status = status
  }
}

const BASE = "/api/team"

async function readError(response: Response): Promise<TeamClientError> {
  let code: string | null = null
  let message = `team request failed with status ${response.status}`
  try {
    const parsed = errorEnvelope.safeParse(await response.json())
    if (parsed.success) {
      code = parsed.data.error.code
      message = parsed.data.error.message || message
    }
  } catch {
    // 无 JSON 错误体：保留状态码描述。
  }
  return new TeamClientError(message, code, response.status)
}

async function requestData<T extends ZodTypeAny>(
  path: string,
  inner: T,
  init?: RequestInit,
): Promise<z.infer<T>> {
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, { cache: "no-store", ...init })
  } catch (error) {
    throw new TeamClientError(error instanceof Error ? error.message : String(error), null, null)
  }
  if (!response.ok) {
    throw await readError(response)
  }
  const raw: unknown = await response.json().catch(() => null)
  return dataEnvelope(inner).parse(raw).data
}

function jsonPost(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
}

export type TeamClient = {
  currentNamespace: () => Promise<string | null>
  listMyTeams: () => Promise<TeamSummary[]>
  listInvites: () => Promise<PendingInvite[]>
  teamDetail: (teamId: string) => Promise<TeamDetail>
  createInvite: (teamId: string, email: string, role: "admin" | "member") => Promise<void>
  acceptInvite: (inviteId: string) => Promise<void>
  declineInvite: (inviteId: string) => Promise<void>
  changeRole: (teamId: string, targetUserId: string, role: TeamRole) => Promise<void>
  removeMember: (teamId: string, targetUserId: string) => Promise<void>
  switchTeam: (teamId: string) => Promise<string>
}

export function createTeamClient(): TeamClient {
  return {
    currentNamespace: async () => {
      const res = await fetch(`${BASE}/context`, { cache: "no-store" })
      if (!res.ok) return null
      const parsed = z.object({ namespace: z.string().nullable() }).safeParse(await res.json().catch(() => null))
      return parsed.success ? parsed.data.namespace : null
    },
    listMyTeams: () => requestData("/me/teams", z.array(teamSummarySchema)),
    listInvites: () => requestData("/me/invites", z.array(pendingInviteSchema)),
    teamDetail: (teamId) => requestData(`/teams/${encodeURIComponent(teamId)}`, teamDetailSchema),
    createInvite: async (teamId, email, role) => {
      await requestData(`/teams/${encodeURIComponent(teamId)}/invites`, z.unknown(), jsonPost({ email, role }))
    },
    acceptInvite: async (inviteId) => {
      await requestData(`/invites/${encodeURIComponent(inviteId)}/accept`, z.unknown(), { method: "POST" })
    },
    declineInvite: async (inviteId) => {
      await requestData(`/invites/${encodeURIComponent(inviteId)}/decline`, z.unknown(), { method: "POST" })
    },
    changeRole: async (teamId, targetUserId, role) => {
      await requestData(
        `/teams/${encodeURIComponent(teamId)}/members/change-role`,
        z.unknown(),
        jsonPost({ targetUserId, role }),
      )
    },
    removeMember: async (teamId, targetUserId) => {
      await requestData(
        `/teams/${encodeURIComponent(teamId)}/members/remove`,
        z.unknown(),
        jsonPost({ targetUserId }),
      )
    },
    // 切换：命中专用 re-seal 路由（不经通用代理）；成功回新 namespace，调用方据此整页刷新。
    switchTeam: async (teamId) => {
      let response: Response
      try {
        response = await fetch(`${BASE}/switch`, jsonPost({ team_id: teamId }))
      } catch (error) {
        throw new TeamClientError(error instanceof Error ? error.message : String(error), null, null)
      }
      if (!response.ok) {
        throw new TeamClientError(`switch failed with status ${response.status}`, null, response.status)
      }
      const parsed = z.object({ ok: z.boolean(), namespace: z.string() }).safeParse(await response.json().catch(() => null))
      if (!parsed.success) {
        throw new TeamClientError("invalid switch response", null, response.status)
      }
      return parsed.data.namespace
    },
  }
}
