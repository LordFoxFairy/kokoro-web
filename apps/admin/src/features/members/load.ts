import { pageStateFromError, type PageState } from '../../lib/page-state'
import type {
  AdminDataClient,
  Member,
  Page,
  PageRequest,
  RequestContext,
  Scope,
  ScopePageRequest,
} from '../../lib/view-models'

type PageInput = Pick<PageRequest, 'pageSize' | 'pageToken' | 'query' | 'sort'>

export async function loadMembers(
  client: Pick<AdminDataClient, 'listMembers'>,
  scope: Scope,
  page: PageInput = {},
  context?: RequestContext
): Promise<PageState<Page<Member>>> {
  const request: ScopePageRequest = { scope, ...page }

  try {
    const result = await client.listMembers(request, context)
    const filtered = Boolean(page.query || page.pageToken)
    return result.data.items.length === 0 && !filtered
      ? { status: 'empty' }
      : { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(error, context?.requestId ?? 'admin.members')
  }
}
