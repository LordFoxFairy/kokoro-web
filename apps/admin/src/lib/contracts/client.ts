import type {
  CapabilityProjection,
  ContractResult,
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

export interface AdminContractClient {
  getCurrentIdentity(
    context?: RequestContext
  ): Promise<ContractResult<CurrentIdentity>>
  getCapabilities(
    scope: Scope,
    context?: RequestContext
  ): Promise<ContractResult<CapabilityProjection>>
  getDashboard(
    scope: Scope,
    context?: RequestContext
  ): Promise<ContractResult<DashboardSummary>>
  listUsers(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<ContractResult<Page<User>>>
  getUser(id: EntityId, context?: RequestContext): Promise<ContractResult<User>>
  listOrganizations(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<ContractResult<Page<Organization>>>
  getOrganization(
    id: EntityId,
    context?: RequestContext
  ): Promise<ContractResult<Organization>>
  listSites(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<ContractResult<Page<Site>>>
  getSite(id: EntityId, context?: RequestContext): Promise<ContractResult<Site>>
  listMembers(
    request: ScopePageRequest,
    context?: RequestContext
  ): Promise<ContractResult<Page<Member>>>
  listRoles(
    request: ScopePageRequest,
    context?: RequestContext
  ): Promise<ContractResult<Page<Role>>>
  getRole(id: EntityId, context?: RequestContext): Promise<ContractResult<Role>>
  listPermissions(
    scope: Scope,
    context?: RequestContext
  ): Promise<ContractResult<readonly Permission[]>>
  listSessions(
    request?: SessionPageRequest,
    context?: RequestContext
  ): Promise<ContractResult<Page<Session>>>
  getSession(
    id: EntityId,
    context?: RequestContext
  ): Promise<ContractResult<Session>>
  listAudit(
    request?: AuditPageRequest,
    context?: RequestContext
  ): Promise<ContractResult<Page<AuditEvent>>>
  getAuditEvent(
    id: EntityId,
    context?: RequestContext
  ): Promise<ContractResult<AuditEvent>>
  checkAccess(
    input: AccessCheckInput,
    context?: RequestContext
  ): Promise<ContractResult<AccessCheck>>
}
