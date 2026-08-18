import {
  ADMIN_CONTRACT_VERSION,
  type AccessCheck,
  type AccessCheckInput,
  type AdminContractClient,
  type AdminError,
  type AuditPageRequest,
  type ContractResult,
  type DashboardSummary,
  type EntityId,
  type Page,
  type PageRequest,
  type RequestContext,
  type Scope,
  type ScopePageRequest,
  type SessionPageRequest,
  type StatusPageRequest,
} from '../contracts'
import {
  FIXTURE_NOW,
  fixtureAudit,
  fixtureCapabilities,
  fixtureMembers,
  fixtureOrganizations,
  fixturePermissions,
  fixtureRoles,
  fixtureSessions,
  fixtureSites,
  fixtureUsers,
} from './data'

const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 100

type Searchable<T> = (item: T) => string
type SortValue<T> = (item: T) => string | number

function scopeKey(scope: Scope): string {
  return scope.type === 'platform' ? 'platform' : `${scope.type}:${scope.id}`
}

function sameScope(left: Scope, right: Scope): boolean {
  return scopeKey(left) === scopeKey(right)
}

function contractError(
  code: AdminError['code'],
  requestId: string,
  businessCode?: string
): AdminError {
  return {
    kind: 'admin-contract-error',
    code,
    businessCode,
    fieldViolations: [],
    requestId,
  }
}

function decodeOffset(
  token: string | undefined,
  signature: string,
  requestId: string
): number {
  if (!token) return 0
  const prefix = `fixture:${ADMIN_CONTRACT_VERSION}:${signature}:`
  if (!token.startsWith(prefix))
    throw contractError('INVALID_ARGUMENT', requestId, 'INVALID_PAGE_TOKEN')
  const offset = Number(token.slice(prefix.length))
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw contractError('INVALID_ARGUMENT', requestId, 'INVALID_PAGE_TOKEN')
  }
  return offset
}

function compare(left: string | number, right: string | number): number {
  return typeof left === 'number' && typeof right === 'number'
    ? left - right
    : String(left).localeCompare(String(right))
}

function paginate<T>(
  source: readonly T[],
  request: PageRequest | undefined,
  signature: string,
  requestId: string,
  searchable: Searchable<T>,
  sortFields: Readonly<Record<string, SortValue<T>>>
): Page<T> {
  const pageSize = request?.pageSize ?? DEFAULT_PAGE_SIZE
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > MAX_PAGE_SIZE
  ) {
    throw contractError('INVALID_ARGUMENT', requestId, 'INVALID_PAGE_SIZE')
  }

  const query = request?.query?.trim().toLocaleLowerCase()
  let items = query
    ? source.filter((item) =>
        searchable(item).toLocaleLowerCase().includes(query)
      )
    : [...source]
  const sort = request?.sort
  if (sort) {
    const value = sortFields[sort.field]
    if (!value)
      throw contractError('INVALID_ARGUMENT', requestId, 'UNSUPPORTED_SORT')
    items = [...items].sort(
      (left, right) =>
        compare(value(left), value(right)) * (sort.direction === 'asc' ? 1 : -1)
    )
  }

  const offset = decodeOffset(request?.pageToken, signature, requestId)
  const nextOffset = offset + pageSize
  return {
    items: items.slice(offset, nextOffset),
    nextPageToken:
      nextOffset < items.length
        ? `fixture:${ADMIN_CONTRACT_VERSION}:${signature}:${nextOffset}`
        : undefined,
    totalCount: items.length,
  }
}

function withStatuses<T extends { readonly status: string }>(
  source: readonly T[],
  request?: StatusPageRequest
): readonly T[] {
  return request?.statuses?.length
    ? source.filter((item) => request.statuses?.includes(item.status as never))
    : source
}

export class FixtureAdminContractClient implements AdminContractClient {
  private requestSequence = 0

  private requestId(context: RequestContext | undefined): string {
    this.requestSequence += 1
    return (
      context?.requestId ??
      `req_fixture_${String(this.requestSequence).padStart(4, '0')}`
    )
  }

  private result<T>(data: T, context?: RequestContext): ContractResult<T> {
    if (context?.signal?.aborted)
      throw contractError(
        'DEADLINE_EXCEEDED',
        this.requestId(context),
        'REQUEST_ABORTED'
      )
    return {
      data,
      requestId: this.requestId(context),
      contractVersion: ADMIN_CONTRACT_VERSION,
    }
  }

  async getCurrentIdentity(context?: RequestContext) {
    return this.result(
      {
        id: 'usr_ada',
        displayName: 'Ada Chen',
        email: 'ada@example.test',
        capabilities: fixtureCapabilities,
      },
      context
    )
  }

  async getCapabilities(scope: Scope, context?: RequestContext) {
    const capabilities = fixtureCapabilities.filter((capability) =>
      sameScope(capability.scope, scope)
    )
    return this.result(
      {
        contractVersion: ADMIN_CONTRACT_VERSION,
        subjectId: 'usr_ada',
        capabilities,
        projectedAt: FIXTURE_NOW,
      },
      context
    )
  }

  async getDashboard(_scope: Scope, context?: RequestContext) {
    const metrics: DashboardSummary['metrics'] = [
      {
        key: 'users',
        value: fixtureUsers.length,
        windowLabel: 'Current',
        targetPath: '/users',
      },
      {
        key: 'organizations',
        value: fixtureOrganizations.length,
        windowLabel: 'Current',
        targetPath: '/organizations',
      },
      {
        key: 'sites',
        value: fixtureSites.length,
        windowLabel: 'Current',
        targetPath: '/sites',
      },
      {
        key: 'activeSessions',
        value: fixtureSessions.filter((session) => session.status === 'active')
          .length,
        windowLabel: 'Current',
        targetPath: '/sessions?status=active',
      },
      {
        key: 'securityEvents',
        value: fixtureAudit.filter((event) => event.outcome !== 'success')
          .length,
        windowLabel: 'Last 24 hours',
        targetPath: '/audit?outcome=denied%2Cfailure',
      },
    ]
    return this.result(
      {
        generatedAt: FIXTURE_NOW,
        metrics,
        recentAudit: fixtureAudit.slice(0, 3),
      },
      context
    )
  }

  async listUsers(request?: StatusPageRequest, context?: RequestContext) {
    const requestId = this.requestId(context)
    const page = paginate(
      withStatuses(fixtureUsers, request),
      request,
      'users',
      requestId,
      (user) => `${user.id} ${user.displayName} ${user.email}`,
      {
        createdAt: (user) => user.createdAt,
        displayName: (user) => user.displayName,
        email: (user) => user.email,
        status: (user) => user.status,
        updatedAt: (user) => user.updatedAt,
      }
    )
    return { data: page, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }

  async getUser(id: EntityId, context?: RequestContext) {
    return this.find(fixtureUsers, id, context)
  }

  async listOrganizations(
    request?: StatusPageRequest,
    context?: RequestContext
  ) {
    const requestId = this.requestId(context)
    const page = paginate(
      withStatuses(fixtureOrganizations, request),
      request,
      'organizations',
      requestId,
      (organization) =>
        `${organization.id} ${organization.name} ${organization.slug}`,
      {
        createdAt: (organization) => organization.createdAt,
        name: (organization) => organization.name,
        slug: (organization) => organization.slug,
        status: (organization) => organization.status,
        updatedAt: (organization) => organization.updatedAt,
      }
    )
    return { data: page, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }

  async getOrganization(id: EntityId, context?: RequestContext) {
    return this.find(fixtureOrganizations, id, context)
  }

  async listSites(request?: StatusPageRequest, context?: RequestContext) {
    const requestId = this.requestId(context)
    const page = paginate(
      withStatuses(fixtureSites, request),
      request,
      'sites',
      requestId,
      (site) => `${site.id} ${site.name} ${site.slug} ${site.organizationId}`,
      {
        createdAt: (site) => site.createdAt,
        name: (site) => site.name,
        slug: (site) => site.slug,
        status: (site) => site.status,
        updatedAt: (site) => site.updatedAt,
      }
    )
    return { data: page, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }

  async getSite(id: EntityId, context?: RequestContext) {
    return this.find(fixtureSites, id, context)
  }

  async listMembers(request: ScopePageRequest, context?: RequestContext) {
    const requestId = this.requestId(context)
    const source = fixtureMembers.filter((member) =>
      sameScope(member.scope, request.scope)
    )
    const page = paginate(
      source,
      request,
      `members:${scopeKey(request.scope)}`,
      requestId,
      (member) => `${member.id} ${member.userId} ${member.roleIds.join(' ')}`,
      {
        joinedAt: (member) => member.joinedAt,
        status: (member) => member.status,
        userId: (member) => member.userId,
      }
    )
    return { data: page, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }

  async listRoles(request: ScopePageRequest, context?: RequestContext) {
    const requestId = this.requestId(context)
    const source = fixtureRoles.filter((role) =>
      sameScope(role.scope, request.scope)
    )
    const page = paginate(
      source,
      request,
      `roles:${scopeKey(request.scope)}`,
      requestId,
      (role) => `${role.id} ${role.name} ${role.description ?? ''}`,
      {
        memberCount: (role) => role.memberCount,
        name: (role) => role.name,
        status: (role) => role.status,
        updatedAt: (role) => role.updatedAt,
      }
    )
    return { data: page, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }

  async getRole(id: EntityId, context?: RequestContext) {
    return this.find(fixtureRoles, id, context)
  }

  async listPermissions(_scope: Scope, context?: RequestContext) {
    return this.result(fixturePermissions, context)
  }

  async listSessions(request?: SessionPageRequest, context?: RequestContext) {
    const requestId = this.requestId(context)
    const source = fixtureSessions.filter(
      (session) =>
        (!request?.userId || session.userId === request.userId) &&
        (!request?.statuses?.length ||
          request.statuses.includes(session.status))
    )
    const page = paginate(
      source,
      request,
      'sessions',
      requestId,
      (session) =>
        `${session.id} ${session.userId} ${session.clientLabel} ${session.ipAddress ?? ''}`,
      {
        createdAt: (session) => session.createdAt,
        expiresAt: (session) => session.expiresAt,
        lastActiveAt: (session) => session.lastActiveAt,
        status: (session) => session.status,
      }
    )
    return { data: page, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }

  async getSession(id: EntityId, context?: RequestContext) {
    return this.find(fixtureSessions, id, context)
  }

  async listAudit(request?: AuditPageRequest, context?: RequestContext) {
    const requestId = this.requestId(context)
    const source = fixtureAudit.filter(
      (event) =>
        (!request?.actorId || event.actorId === request.actorId) &&
        (!request?.targetId || event.targetId === request.targetId) &&
        (!request?.requestId || event.requestId === request.requestId) &&
        (!request?.outcomes?.length ||
          request.outcomes.includes(event.outcome)) &&
        (!request?.scope ||
          (event.scope && sameScope(event.scope, request.scope)))
    )
    const page = paginate(
      source,
      request,
      'audit',
      requestId,
      (event) =>
        `${event.id} ${event.action} ${event.targetType} ${event.targetId ?? ''} ${event.requestId}`,
      {
        action: (event) => event.action,
        occurredAt: (event) => event.occurredAt,
        outcome: (event) => event.outcome,
      }
    )
    return { data: page, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }

  async getAuditEvent(id: EntityId, context?: RequestContext) {
    return this.find(fixtureAudit, id, context)
  }

  async checkAccess(input: AccessCheckInput, context?: RequestContext) {
    const capabilityKey = `${input.resource}.${input.action}`
    const capability = fixtureCapabilities.find(
      (item) => item.key === capabilityKey && sameScope(item.scope, input.scope)
    )
    const data: AccessCheck = {
      ...input,
      allowed: Boolean(capability),
      checkedAt: FIXTURE_NOW,
      reasonCode: capability
        ? 'FIXTURE_CAPABILITY_PRESENT'
        : 'FIXTURE_CAPABILITY_ABSENT',
      evidence: capability ? [capability.key, scopeKey(capability.scope)] : [],
    }
    return this.result(data, context)
  }

  private async find<T extends { readonly id: EntityId }>(
    source: readonly T[],
    id: EntityId,
    context?: RequestContext
  ) {
    const requestId = this.requestId(context)
    if (context?.signal?.aborted)
      throw contractError('DEADLINE_EXCEEDED', requestId, 'REQUEST_ABORTED')
    const item = source.find((candidate) => candidate.id === id)
    if (!item) throw contractError('NOT_FOUND', requestId)
    return { data: item, requestId, contractVersion: ADMIN_CONTRACT_VERSION }
  }
}

export function createFixtureAdminContractClient(): AdminContractClient {
  return new FixtureAdminContractClient()
}
