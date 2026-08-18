import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  DataResult,
  EntityId,
  Organization,
  RequestContext,
  Site,
  User,
} from '../../lib/view-models'

type DirectoryDetailByResource = {
  readonly users: User
  readonly organizations: Organization
  readonly sites: Site
}

export type DirectoryDetailResource = keyof DirectoryDetailByResource

type DetailLoaderMap = {
  readonly [Resource in DirectoryDetailResource]: (
    client: AdminDataClient,
    id: EntityId,
    context?: RequestContext
  ) => Promise<DataResult<DirectoryDetailByResource[Resource]>>
}

const DETAIL_LOADERS: DetailLoaderMap = {
  users: (client, id, context) => client.getUser(id, context),
  organizations: (client, id, context) => client.getOrganization(id, context),
  sites: (client, id, context) => client.getSite(id, context),
}

const FALLBACK_REQUEST_IDS = {
  users: 'req_admin_detail_users',
  organizations: 'req_admin_detail_organizations',
  sites: 'req_admin_detail_sites',
} as const satisfies Readonly<Record<DirectoryDetailResource, string>>

export async function loadDirectoryDetail<
  Resource extends DirectoryDetailResource,
>(
  client: AdminDataClient,
  resource: Resource,
  id: EntityId,
  context?: RequestContext
): Promise<PageState<DirectoryDetailByResource[Resource]>> {
  const fallbackRequestId = context?.requestId ?? FALLBACK_REQUEST_IDS[resource]

  try {
    const result = await DETAIL_LOADERS[resource](client, id, context)
    return { status: 'ready', data: result.data }
  } catch (error: unknown) {
    return pageStateFromError(error, fallbackRequestId)
  }
}
