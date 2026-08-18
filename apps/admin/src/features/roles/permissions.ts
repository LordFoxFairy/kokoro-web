import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  Permission,
  RequestContext,
  Scope,
} from '../../lib/view-models'

export async function loadPermissions(
  client: Pick<AdminDataClient, 'listPermissions'>,
  scope: Scope | undefined,
  context?: RequestContext
): Promise<PageState<readonly Permission[]>> {
  if (!scope) return { status: 'empty' }

  try {
    const result = await client.listPermissions(scope, context)
    return result.data.length === 0
      ? { status: 'empty' }
      : { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.permissions')
  }
}
