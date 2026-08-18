import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AccessCheck,
  AccessCheckInput,
  AdminDataClient,
  RequestContext,
} from '../../lib/view-models'
import type { AccessSearch } from './search'

function inputFor(search: AccessSearch): AccessCheckInput | undefined {
  if (
    !search.subjectId ||
    !search.scopeType ||
    !search.resource ||
    !search.action
  ) {
    return undefined
  }

  if (search.scopeType === 'platform') {
    return {
      subjectId: search.subjectId,
      scope: { type: 'platform' },
      resource: search.resource,
      action: search.action,
    }
  }
  if (!search.scopeId) return undefined

  return {
    subjectId: search.subjectId,
    scope: { type: search.scopeType, id: search.scopeId },
    resource: search.resource,
    action: search.action,
  }
}

export async function loadAccess(
  client: Pick<AdminDataClient, 'checkAccess'>,
  search: AccessSearch,
  context?: RequestContext
): Promise<PageState<AccessCheck>> {
  const input = inputFor(search)
  if (!input) return { status: 'empty' }

  try {
    const result = await client.checkAccess(input, context)
    return { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.access')
  }
}
