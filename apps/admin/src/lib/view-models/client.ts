import type {
  CapabilityProjection,
  DataResult,
  EntityId,
  Page,
  PageRequest,
  RequestContext,
  Scope,
} from './common'
import type {
  AccessCheck,
  AccessCheckInput,
  AuditEvent,
  AuditOutcome,
  CurrentIdentity,
  DashboardSummary,
  EntityStatus,
  Member,
  Organization,
  Permission,
  Role,
  Session,
  SessionStatus,
  Site,
  User,
} from './models'

export type StatusPageRequest = PageRequest & {
  readonly statuses?: readonly EntityStatus[]
}

export type SessionPageRequest = PageRequest & {
  readonly userId?: EntityId
  readonly statuses?: readonly SessionStatus[]
}

export type AuditPageRequest = PageRequest & {
  readonly actorId?: EntityId
  readonly targetId?: EntityId
  readonly requestId?: string
  readonly outcomes?: readonly AuditOutcome[]
  readonly scope?: Scope
}

export type ScopePageRequest = PageRequest & { readonly scope: Scope }

export interface AdminDataClient {
  getCurrentIdentity(
    context?: RequestContext
  ): Promise<DataResult<CurrentIdentity>>
  getCapabilities(
    scope: Scope,
    context?: RequestContext
  ): Promise<DataResult<CapabilityProjection>>
  getDashboard(
    scope: Scope,
    context?: RequestContext
  ): Promise<DataResult<DashboardSummary>>
  listUsers(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<User>>>
  getUser(id: EntityId, context?: RequestContext): Promise<DataResult<User>>
  listOrganizations(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Organization>>>
  getOrganization(
    id: EntityId,
    context?: RequestContext
  ): Promise<DataResult<Organization>>
  listSites(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Site>>>
  getSite(id: EntityId, context?: RequestContext): Promise<DataResult<Site>>
  listMembers(
    request: ScopePageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Member>>>
  listRoles(
    request: ScopePageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Role>>>
  getRole(id: EntityId, context?: RequestContext): Promise<DataResult<Role>>
  listPermissions(
    scope: Scope,
    context?: RequestContext
  ): Promise<DataResult<readonly Permission[]>>
  listSessions(
    request?: SessionPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Session>>>
  getSession(
    id: EntityId,
    context?: RequestContext
  ): Promise<DataResult<Session>>
  listAudit(
    request?: AuditPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<AuditEvent>>>
  getAuditEvent(
    id: EntityId,
    context?: RequestContext
  ): Promise<DataResult<AuditEvent>>
  checkAccess(
    input: AccessCheckInput,
    context?: RequestContext
  ): Promise<DataResult<AccessCheck>>
}
