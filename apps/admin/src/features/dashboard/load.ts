import {
  pageStateFromError,
  partialPageState,
  type PageState,
} from '../../lib/page-state'
import type {
  AdminDataClient,
  AdminError,
  DashboardSummary,
  RequestContext,
  Scope,
} from '../../lib/view-models'

const DASHBOARD_LOAD_REQUEST_ID = 'req_admin_dashboard_load'

function partialDashboardError(requestId: string): AdminError {
  return {
    kind: 'admin-data-error',
    code: 'UNAVAILABLE',
    businessCode: 'DASHBOARD_PARTIAL',
    fieldViolations: [],
    requestId,
  }
}

export async function loadDashboardPage(
  client: AdminDataClient,
  scope: Scope,
  context?: RequestContext
): Promise<PageState<DashboardSummary>> {
  try {
    const result = await client.getDashboard(scope, context)

    if (
      result.data.sections.metrics === 'unavailable' ||
      result.data.sections.recentAudit === 'unavailable'
    ) {
      return partialPageState(
        result.data,
        partialDashboardError(result.requestId)
      )
    }

    if (
      result.data.metrics.length === 0 &&
      result.data.recentAudit.length === 0
    ) {
      return { status: 'empty' }
    }

    return { status: 'ready', data: result.data }
  } catch (error) {
    return pageStateFromError(
      error,
      context?.requestId ?? DASHBOARD_LOAD_REQUEST_ID
    )
  }
}
