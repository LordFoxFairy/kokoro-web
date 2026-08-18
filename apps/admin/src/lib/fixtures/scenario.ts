import { isParsedAdminEnv, type AdminEnv } from '../env'
import {
  ADMIN_FIXTURE_SCHEMA_VERSION,
  type AccessCheckInput,
  type AdminDataClient,
  type AdminError,
  type AuditEvent,
  type AuditPageRequest,
  type CapabilityProjection,
  type CurrentIdentity,
  type DataResult,
  type DashboardSummary,
  type EntityId,
  type Member,
  type Organization,
  type Page,
  type Permission,
  type RequestContext,
  type Role,
  type Scope,
  type ScopePageRequest,
  type Session,
  type SessionPageRequest,
  type Site,
  type StatusPageRequest,
  type User,
} from '../view-models'
import { FixtureAdminDataClient } from './client'
import { FIXTURE_NOW } from './data'

export type FixtureScenario =
  'ready' | 'empty' | 'forbidden' | 'not-found' | 'unavailable' | 'partial'

export type FixtureOperation = keyof AdminDataClient

const FIXTURE_OPERATIONS = new Set<FixtureOperation>([
  'getCurrentIdentity',
  'getCapabilities',
  'getDashboard',
  'listUsers',
  'getUser',
  'listOrganizations',
  'getOrganization',
  'listSites',
  'getSite',
  'listMembers',
  'listRoles',
  'getRole',
  'listPermissions',
  'listSessions',
  'getSession',
  'listAudit',
  'getAuditEvent',
  'checkAccess',
])
const FIXTURE_SCENARIOS = new Set<FixtureScenario>([
  'ready',
  'empty',
  'forbidden',
  'not-found',
  'unavailable',
  'partial',
])

export type FixtureScenarioConfig = Readonly<{
  operations: Readonly<Partial<Record<FixtureOperation, FixtureScenario>>>
}>

export type FixtureScenarioErrorCode = 'INVALID_FIXTURE_SCENARIO'

export class FixtureScenarioConfigurationError extends Error {
  readonly code: FixtureScenarioErrorCode

  constructor(code: FixtureScenarioErrorCode, message: string) {
    super(message)
    this.name = 'FixtureScenarioConfigurationError'
    this.code = code
  }
}

const EMPTY_OPERATIONS = new Set<FixtureOperation>([
  'getCapabilities',
  'getDashboard',
  'listUsers',
  'listOrganizations',
  'listSites',
  'listMembers',
  'listRoles',
  'listPermissions',
  'listSessions',
  'listAudit',
])

function validateConfig(config: FixtureScenarioConfig): void {
  for (const [operation, scenario] of Object.entries(config.operations) as [
    FixtureOperation,
    FixtureScenario,
  ][]) {
    if (!FIXTURE_OPERATIONS.has(operation)) {
      throw new FixtureScenarioConfigurationError(
        'INVALID_FIXTURE_SCENARIO',
        `Unknown fixture operation: ${operation}`
      )
    }
    if (!FIXTURE_SCENARIOS.has(scenario)) {
      throw new FixtureScenarioConfigurationError(
        'INVALID_FIXTURE_SCENARIO',
        `Unknown fixture scenario for ${operation}: ${scenario}`
      )
    }
    if (scenario === 'partial' && operation !== 'getDashboard') {
      throw new FixtureScenarioConfigurationError(
        'INVALID_FIXTURE_SCENARIO',
        `The partial fixture scenario is only valid for getDashboard, not ${operation}`
      )
    }
    if (scenario === 'empty' && !EMPTY_OPERATIONS.has(operation)) {
      throw new FixtureScenarioConfigurationError(
        'INVALID_FIXTURE_SCENARIO',
        `The empty fixture scenario cannot represent ${operation}`
      )
    }
  }
}

function requestId(
  operation: FixtureOperation,
  scenario: FixtureScenario,
  context?: RequestContext
): string {
  return context?.requestId ?? `req_fixture_${operation}_${scenario}`
}

function scenarioError(
  operation: FixtureOperation,
  scenario: 'forbidden' | 'not-found' | 'unavailable',
  context?: RequestContext
): AdminError {
  const codes = {
    forbidden: 'PERMISSION_DENIED',
    'not-found': 'NOT_FOUND',
    unavailable: 'UNAVAILABLE',
  } as const
  return {
    kind: 'admin-data-error',
    code: codes[scenario],
    businessCode: `FIXTURE_${scenario.replace('-', '_').toUpperCase()}`,
    fieldViolations: [],
    requestId: requestId(operation, scenario, context),
  }
}

function emptyPage<T>(): Page<T> {
  return { items: [], totalCount: 0 }
}

function result<T>(
  operation: FixtureOperation,
  scenario: FixtureScenario,
  data: T,
  context?: RequestContext
): DataResult<T> {
  return {
    data,
    requestId: requestId(operation, scenario, context),
    schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
  }
}

function assertNotAborted(
  operation: FixtureOperation,
  scenario: FixtureScenario,
  context?: RequestContext
): void {
  if (!context?.signal?.aborted) return
  throw {
    kind: 'admin-data-error',
    code: 'DEADLINE_EXCEEDED',
    businessCode: 'REQUEST_ABORTED',
    fieldViolations: [],
    requestId: requestId(operation, scenario, context),
  } satisfies AdminError
}

/**
 * Decorates the deterministic fixture client with scenarios selected at
 * construction time. Request data never selects or changes a scenario.
 */
class ScenarioFixtureAdminDataClient implements AdminDataClient {
  constructor(
    private readonly base: AdminDataClient,
    private readonly config: FixtureScenarioConfig
  ) {
    validateConfig(config)
  }

  private scenario(operation: FixtureOperation): FixtureScenario {
    return this.config.operations[operation] ?? 'ready'
  }

  private async resolve<T>(
    operation: FixtureOperation,
    context: RequestContext | undefined,
    ready: () => Promise<DataResult<T>>,
    empty?: () => T
  ): Promise<DataResult<T>> {
    const scenario = this.scenario(operation)
    assertNotAborted(operation, scenario, context)
    if (scenario === 'ready') return ready()
    if (
      scenario === 'forbidden' ||
      scenario === 'not-found' ||
      scenario === 'unavailable'
    ) {
      throw scenarioError(operation, scenario, context)
    }
    if (scenario === 'empty' && empty) {
      return result(operation, scenario, empty(), context)
    }
    throw new FixtureScenarioConfigurationError(
      'INVALID_FIXTURE_SCENARIO',
      `The ${scenario} fixture scenario cannot represent ${operation}`
    )
  }

  getCurrentIdentity(
    context?: RequestContext
  ): Promise<DataResult<CurrentIdentity>> {
    return this.resolve('getCurrentIdentity', context, () =>
      this.base.getCurrentIdentity(context)
    )
  }

  getCapabilities(
    scope: Scope,
    context?: RequestContext
  ): Promise<DataResult<CapabilityProjection>> {
    return this.resolve(
      'getCapabilities',
      context,
      () => this.base.getCapabilities(scope, context),
      () => ({
        schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
        subjectId: 'usr_fixture_empty',
        capabilities: [],
        projectedAt: FIXTURE_NOW,
      })
    )
  }

  async getDashboard(
    scope: Scope,
    context?: RequestContext
  ): Promise<DataResult<DashboardSummary>> {
    const scenario = this.scenario('getDashboard')
    if (scenario === 'partial') {
      const complete = await this.base.getDashboard(scope, context)
      const partial: DataResult<DashboardSummary> = {
        ...complete,
        data: {
          ...complete.data,
          sections: { ...complete.data.sections, recentAudit: 'unavailable' },
          recentAudit: [],
        },
      }
      return partial
    }
    return this.resolve(
      'getDashboard',
      context,
      () => this.base.getDashboard(scope, context),
      () => ({
        generatedAt: FIXTURE_NOW,
        sections: { metrics: 'ready', recentAudit: 'ready' },
        metrics: [],
        recentAudit: [],
      })
    )
  }

  listUsers(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<User>>> {
    return this.resolve(
      'listUsers',
      context,
      () => this.base.listUsers(request, context),
      emptyPage<User>
    )
  }

  getUser(id: EntityId, context?: RequestContext): Promise<DataResult<User>> {
    return this.resolve('getUser', context, () =>
      this.base.getUser(id, context)
    )
  }

  listOrganizations(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Organization>>> {
    return this.resolve(
      'listOrganizations',
      context,
      () => this.base.listOrganizations(request, context),
      emptyPage<Organization>
    )
  }

  getOrganization(
    id: EntityId,
    context?: RequestContext
  ): Promise<DataResult<Organization>> {
    return this.resolve('getOrganization', context, () =>
      this.base.getOrganization(id, context)
    )
  }

  listSites(
    request?: StatusPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Site>>> {
    return this.resolve(
      'listSites',
      context,
      () => this.base.listSites(request, context),
      emptyPage<Site>
    )
  }

  getSite(id: EntityId, context?: RequestContext): Promise<DataResult<Site>> {
    return this.resolve('getSite', context, () =>
      this.base.getSite(id, context)
    )
  }

  listMembers(
    request: ScopePageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Member>>> {
    return this.resolve(
      'listMembers',
      context,
      () => this.base.listMembers(request, context),
      emptyPage<Member>
    )
  }

  listRoles(
    request: ScopePageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Role>>> {
    return this.resolve(
      'listRoles',
      context,
      () => this.base.listRoles(request, context),
      emptyPage<Role>
    )
  }

  getRole(id: EntityId, context?: RequestContext): Promise<DataResult<Role>> {
    return this.resolve('getRole', context, () =>
      this.base.getRole(id, context)
    )
  }

  listPermissions(
    scope: Scope,
    context?: RequestContext
  ): Promise<DataResult<readonly Permission[]>> {
    return this.resolve(
      'listPermissions',
      context,
      () => this.base.listPermissions(scope, context),
      () => []
    )
  }

  listSessions(
    request?: SessionPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<Session>>> {
    return this.resolve(
      'listSessions',
      context,
      () => this.base.listSessions(request, context),
      emptyPage<Session>
    )
  }

  getSession(
    id: EntityId,
    context?: RequestContext
  ): Promise<DataResult<Session>> {
    return this.resolve('getSession', context, () =>
      this.base.getSession(id, context)
    )
  }

  listAudit(
    request?: AuditPageRequest,
    context?: RequestContext
  ): Promise<DataResult<Page<AuditEvent>>> {
    return this.resolve(
      'listAudit',
      context,
      () => this.base.listAudit(request, context),
      emptyPage<AuditEvent>
    )
  }

  getAuditEvent(id: EntityId, context?: RequestContext) {
    return this.resolve('getAuditEvent', context, () =>
      this.base.getAuditEvent(id, context)
    )
  }

  checkAccess(input: AccessCheckInput, context?: RequestContext) {
    return this.resolve('checkAccess', context, () =>
      this.base.checkAccess(input, context)
    )
  }
}

export function createScenarioFixtureAdminDataClient(
  env: AdminEnv,
  operations: FixtureScenarioConfig['operations'],
  base: AdminDataClient = new FixtureAdminDataClient()
): AdminDataClient {
  if (
    !isParsedAdminEnv(env) ||
    env.ADMIN_DATA_SOURCE !== 'fixture' ||
    (env.NODE_ENV !== 'development' && env.NODE_ENV !== 'test')
  ) {
    throw new FixtureScenarioConfigurationError(
      'INVALID_FIXTURE_SCENARIO',
      'Fixture scenarios require parsed development/test fixture configuration'
    )
  }
  return new ScenarioFixtureAdminDataClient(base, { operations })
}
