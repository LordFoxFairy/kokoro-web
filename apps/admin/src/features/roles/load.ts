import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  AdminError,
  Page,
  PageRequest,
  RequestContext,
  Role,
  Scope,
  ScopePageRequest,
} from '../../lib/view-models'
import type { RolesSearch } from '../access/search'

type PageInput = Pick<PageRequest, 'pageSize' | 'pageToken'>

function scopeFor(search: RolesSearch): Scope | undefined {
  if (search.scopeType === 'platform') return { type: 'platform' }
  return search.scopeType && search.scopeId
    ? { type: search.scopeType, id: search.scopeId }
    : undefined
}

export async function loadRole(
  client: Pick<AdminDataClient, 'getRole'>,
  search: Pick<RolesSearch, 'roleId'>,
  context?: RequestContext
): Promise<PageState<Role>> {
  if (!search.roleId) return { status: 'empty' }

  try {
    const result = await client.getRole(search.roleId, context)
    return { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.role')
  }
}

function unsupported(context?: RequestContext): AdminError {
  return {
    kind: 'admin-data-error',
    code: 'INVALID_ARGUMENT',
    businessCode: 'ADMIN_ROLE_FILTER_UNSUPPORTED',
    fieldViolations: [
      { path: 'includeDeleted', code: 'UNSUPPORTED_BY_CONTRACT' },
    ],
    requestId: context?.requestId ?? 'admin.roles',
  }
}

export async function loadRoles(
  client: Pick<AdminDataClient, 'listRoles'>,
  search: RolesSearch,
  page: PageInput = {},
  context?: RequestContext
): Promise<PageState<Page<Role>>> {
  const scope = scopeFor(search)
  if (!scope) return { status: 'empty' }
  if (search.includeDeleted) {
    return pageStateFromError(unsupported(context), 'admin.roles')
  }

  const request: ScopePageRequest = {
    scope,
    query: search.q,
    pageSize: page.pageSize,
    pageToken: page.pageToken,
  }

  try {
    const result = await client.listRoles(request, context)
    const filtered = Boolean(search.q || page.pageToken)
    return result.data.items.length === 0 && !filtered
      ? { status: 'empty' }
      : { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.roles')
  }
}
