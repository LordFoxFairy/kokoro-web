import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  AdminError,
  Organization,
  Page,
  RequestContext,
  Site,
  StatusPageRequest,
  User,
} from '../../lib/view-models'
import type { DirectoryResource, DirectorySearch } from './search'

type DirectoryPageByResource = {
  readonly users: Page<User>
  readonly organizations: Page<Organization>
  readonly sites: Page<Site>
}

function requestIdFor(
  resource: DirectoryResource,
  context: RequestContext | undefined
): string {
  return context?.requestId ?? `admin.directory.${resource}`
}

function invalidFilter(
  resource: DirectoryResource,
  path: string,
  context: RequestContext | undefined
): AdminError {
  return {
    kind: 'admin-data-error',
    code: 'INVALID_ARGUMENT',
    businessCode: 'ADMIN_DIRECTORY_FILTER_UNSUPPORTED',
    fieldViolations: [{ path, code: 'UNSUPPORTED_BY_CONTRACT' }],
    requestId: requestIdFor(resource, context),
  }
}

function statusesFor<Resource extends DirectoryResource>(
  search: DirectorySearch<Resource>
): StatusPageRequest['statuses'] {
  return search.status === 'all' ? undefined : [search.status]
}

function toRequest<Resource extends DirectoryResource>(
  search: DirectorySearch<Resource>
): StatusPageRequest {
  const statuses = statusesFor(search)

  return {
    query: search.q || undefined,
    pageToken: search.pageToken || undefined,
    pageSize: search.pageSize,
    sort: { field: search.sort, direction: search.dir },
    statuses,
  }
}

function stateFor<Resource extends DirectoryResource, T>(
  page: Page<T>,
  search: DirectorySearch<Resource>
): PageState<Page<T>> {
  const initialEmpty =
    !search.q &&
    search.status === 'all' &&
    !search.includeDeleted &&
    !search.pageToken
  return page.items.length === 0 && initialEmpty
    ? { status: 'empty' }
    : { status: 'ready', data: page }
}

export function loadDirectory(
  client: AdminDataClient,
  resource: 'users',
  search: DirectorySearch<'users'>,
  context?: RequestContext
): Promise<PageState<DirectoryPageByResource['users']>>
export function loadDirectory(
  client: AdminDataClient,
  resource: 'organizations',
  search: DirectorySearch<'organizations'>,
  context?: RequestContext
): Promise<PageState<DirectoryPageByResource['organizations']>>
export function loadDirectory(
  client: AdminDataClient,
  resource: 'sites',
  search: DirectorySearch<'sites'>,
  context?: RequestContext
): Promise<PageState<DirectoryPageByResource['sites']>>
export async function loadDirectory(
  client: AdminDataClient,
  resource: DirectoryResource,
  search: DirectorySearch<DirectoryResource>,
  context?: RequestContext
): Promise<PageState<DirectoryPageByResource[DirectoryResource]>> {
  const fallbackRequestId = requestIdFor(resource, context)

  if (resource === 'sites' && search.organizationId) {
    return pageStateFromError(
      invalidFilter(resource, 'organizationId', context),
      fallbackRequestId
    )
  }

  if (search.includeDeleted) {
    return pageStateFromError(
      invalidFilter(resource, 'includeDeleted', context),
      fallbackRequestId
    )
  }

  const request = toRequest(search)

  try {
    switch (resource) {
      case 'users':
        return stateFor((await client.listUsers(request, context)).data, search)
      case 'organizations':
        return stateFor(
          (await client.listOrganizations(request, context)).data,
          search
        )
      case 'sites':
        return stateFor((await client.listSites(request, context)).data, search)
    }
  } catch (error) {
    return pageStateFromError(error, fallbackRequestId)
  }
}
