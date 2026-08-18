import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  AdminError,
  AuditEvent,
  AuditPageRequest,
  Page,
  PageRequest,
  RequestContext,
  Scope,
  Session,
  SessionPageRequest,
} from '../../lib/view-models'
import type { AuditSearch, SessionSearch } from './search'

type PageInput = Pick<PageRequest, 'pageSize' | 'pageToken'>

function stateFor<T>(
  page: Page<T>,
  filtered: boolean,
  pageToken: string | undefined
): PageState<Page<T>> {
  return page.items.length === 0 && !filtered && !pageToken
    ? { status: 'empty' }
    : { status: 'ready', data: page }
}

function invalidAuditFilter(
  path: string,
  context?: RequestContext
): AdminError {
  return {
    kind: 'admin-data-error',
    code: 'INVALID_ARGUMENT',
    businessCode: 'ADMIN_AUDIT_FILTER_UNSUPPORTED',
    fieldViolations: [{ path, code: 'UNSUPPORTED_BY_CONTRACT' }],
    requestId: context?.requestId ?? 'admin.audit',
  }
}

function auditScope(search: AuditSearch): Scope | AdminError | undefined {
  if (search.scopeType.length === 0) {
    return search.scopeId ? invalidAuditFilter('scopeType') : undefined
  }
  if (search.scopeType.length > 1) return invalidAuditFilter('scopeType')

  const type = search.scopeType[0]
  if (type === 'platform') {
    return search.scopeId ? invalidAuditFilter('scopeId') : { type: 'platform' }
  }
  if (!search.scopeId) return invalidAuditFilter('scopeId')
  return { type, id: search.scopeId }
}

export async function loadSessions(
  client: Pick<AdminDataClient, 'listSessions'>,
  search: SessionSearch,
  page: PageInput = {},
  context?: RequestContext
): Promise<PageState<Page<Session>>> {
  const request: SessionPageRequest = {
    query: search.q,
    userId: search.userId,
    statuses: search.status.length === 0 ? undefined : search.status,
    pageSize: page.pageSize,
    pageToken: page.pageToken,
  }

  try {
    const result = await client.listSessions(request, context)
    return stateFor(
      result.data,
      Boolean(search.q || search.userId || search.status.length),
      page.pageToken
    )
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.sessions')
  }
}

export async function loadAudit(
  client: Pick<AdminDataClient, 'listAudit'>,
  search: AuditSearch,
  page: PageInput = {},
  context?: RequestContext
): Promise<PageState<Page<AuditEvent>>> {
  const scope = auditScope(search)
  if (scope && 'kind' in scope) {
    const error = { ...scope, requestId: context?.requestId ?? scope.requestId }
    return pageStateFromError(error, error.requestId)
  }

  const request: AuditPageRequest = {
    query: search.q,
    actorId: search.actorId,
    targetId: search.targetId,
    requestId: search.requestId,
    outcomes: search.outcome.length === 0 ? undefined : search.outcome,
    scope,
    pageSize: page.pageSize,
    pageToken: page.pageToken,
  }

  try {
    const result = await client.listAudit(request, context)
    return stateFor(
      result.data,
      Boolean(
        search.q ||
        search.actorId ||
        search.targetId ||
        search.requestId ||
        search.outcome.length ||
        search.scopeType.length
      ),
      page.pageToken
    )
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.audit')
  }
}
