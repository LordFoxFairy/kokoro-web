import { describe, expect, it, vi } from 'vitest'
import {
  ADMIN_FIXTURE_SCHEMA_VERSION,
  type AdminDataClient,
  type DashboardSummary,
  type RequestContext,
  type Scope,
} from '../../lib/view-models'
import { loadDashboardPage } from './load'

const scope = { type: 'platform' } satisfies Scope
const summary: DashboardSummary = {
  generatedAt: '2026-08-18T00:00:00.000Z',
  sections: { metrics: 'ready', recentAudit: 'ready' },
  metrics: [
    {
      key: 'users',
      value: 3,
      windowLabel: 'Current',
      targetPath: '/users',
    },
  ],
  recentAudit: [],
}

function clientWithGetDashboard(
  getDashboard: AdminDataClient['getDashboard']
): AdminDataClient {
  return { getDashboard } as AdminDataClient
}

describe('loadDashboardPage', () => {
  it('returns ready data and passes scope and context unchanged', async () => {
    const context: RequestContext = { requestId: 'req_dashboard_ready' }
    const getDashboard = vi.fn().mockResolvedValue({
      data: summary,
      requestId: context.requestId,
      schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
    })

    await expect(
      loadDashboardPage(clientWithGetDashboard(getDashboard), scope, context)
    ).resolves.toEqual({ status: 'ready', data: summary })
    expect(getDashboard).toHaveBeenCalledExactlyOnceWith(scope, context)
  })

  it('returns empty only when metrics and recent audit are both empty', async () => {
    const data: DashboardSummary = {
      generatedAt: summary.generatedAt,
      sections: summary.sections,
      metrics: [],
      recentAudit: [],
    }
    const client = clientWithGetDashboard(
      vi.fn().mockResolvedValue({
        data,
        requestId: 'req_dashboard_empty',
        schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
      })
    )

    await expect(loadDashboardPage(client, scope)).resolves.toEqual({
      status: 'empty',
    })
  })

  it('keeps data ready when either dashboard section has content', async () => {
    const auditOnly = {
      ...summary,
      metrics: [],
      recentAudit: [
        {
          id: 'audit_1',
          occurredAt: summary.generatedAt,
          action: 'dashboard.read',
          targetType: 'dashboard',
          scope,
          outcome: 'success',
          requestId: 'req_dashboard_audit_event',
          attributes: {},
        },
      ],
    } satisfies DashboardSummary
    const client = clientWithGetDashboard(
      vi.fn().mockResolvedValue({
        data: auditOnly,
        requestId: 'req_dashboard_audit',
        schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
      })
    )

    await expect(loadDashboardPage(client, scope)).resolves.toEqual({
      status: 'ready',
      data: auditOnly,
    })
  })

  it('maps contract section availability to a stable safe partial error', async () => {
    const partialData = {
      ...summary,
      sections: { metrics: 'ready', recentAudit: 'unavailable' },
      recentAudit: [],
    } satisfies DashboardSummary
    const client = clientWithGetDashboard(
      vi.fn().mockResolvedValue({
        data: partialData,
        requestId: 'req_dashboard_partial',
        schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
      })
    )

    await expect(loadDashboardPage(client, scope)).resolves.toEqual({
      status: 'partial',
      data: partialData,
      error: {
        code: 'UNAVAILABLE',
        businessCode: 'DASHBOARD_PARTIAL',
        fieldViolations: [],
        requestId: 'req_dashboard_partial',
        retryable: true,
      },
    })
  })

  it('maps AdminError throws without replacing their request id', async () => {
    const client = clientWithGetDashboard(
      vi.fn().mockRejectedValue({
        kind: 'admin-data-error',
        code: 'PERMISSION_DENIED',
        businessCode: 'DASHBOARD_FORBIDDEN',
        fieldViolations: [],
        requestId: 'req_dashboard_denied',
        safeMessage: 'not part of page state',
      })
    )

    await expect(loadDashboardPage(client, scope)).resolves.toEqual({
      status: 'forbidden',
      error: {
        code: 'PERMISSION_DENIED',
        businessCode: 'DASHBOARD_FORBIDDEN',
        fieldViolations: [],
        requestId: 'req_dashboard_denied',
        retryable: false,
      },
    })
  })

  it('uses the context request id for unknown throws', async () => {
    const client = clientWithGetDashboard(
      vi.fn().mockRejectedValue(new Error('backend secret'))
    )

    await expect(
      loadDashboardPage(client, scope, { requestId: 'req_dashboard_context' })
    ).resolves.toEqual({
      status: 'error',
      error: {
        code: 'UNKNOWN',
        fieldViolations: [],
        requestId: 'req_dashboard_context',
        retryable: true,
      },
    })
  })

  it('uses a deterministic fallback request id when context has none', async () => {
    const client = clientWithGetDashboard(
      vi.fn().mockRejectedValue('raw backend failure')
    )

    await expect(loadDashboardPage(client, scope)).resolves.toMatchObject({
      status: 'error',
      error: { requestId: 'req_admin_dashboard_load' },
    })
  })
})
