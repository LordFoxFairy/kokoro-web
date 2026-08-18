import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createFixtureAdminDataClient } from '../../lib/fixtures'
import type { PageState } from '../../lib/page-state'
import type {
  AdminError,
  AuditEvent,
  RequestContext,
  Session,
} from '../../lib/view-models'
import { loadSecurityDetail } from './detail'

function adminError(code: AdminError['code'], requestId: string): AdminError {
  return {
    kind: 'admin-data-error',
    code,
    fieldViolations: [],
    requestId,
  }
}

describe('loadSecurityDetail', () => {
  it('routes session and audit details to their exact client methods', async () => {
    const client = createFixtureAdminDataClient()
    const context: RequestContext = {
      requestId: 'req_security_detail',
      signal: new AbortController().signal,
    }
    const getSession = vi.spyOn(client, 'getSession')
    const getAuditEvent = vi.spyOn(client, 'getAuditEvent')

    const session = await loadSecurityDetail(
      client,
      'sessions',
      'ses_ada_web',
      context
    )
    const audit = await loadSecurityDetail(client, 'audit', 'evt_1003', context)

    expect(session).toMatchObject({
      status: 'ready',
      data: { id: 'ses_ada_web' },
    })
    expect(audit).toMatchObject({ status: 'ready', data: { id: 'evt_1003' } })
    expect(getSession).toHaveBeenCalledWith('ses_ada_web', context)
    expect(getAuditEvent).toHaveBeenCalledWith('evt_1003', context)
    expectTypeOf(session).toEqualTypeOf<PageState<Session>>()
    expectTypeOf(audit).toEqualTypeOf<PageState<AuditEvent>>()
  })

  it('passes opaque IDs unchanged without local lifecycle or format rules', async () => {
    const client = createFixtureAdminDataClient()
    const getSession = vi.spyOn(client, 'getSession')
    const context = { requestId: 'req_opaque_session' }

    await expect(
      loadSecurityDetail(client, 'sessions', ' ses_ada_web ', context)
    ).resolves.toMatchObject({ status: 'not-found' })
    expect(getSession).toHaveBeenCalledWith(' ses_ada_web ', context)
  })

  it.each([
    ['sessions', 'getSession', 'ses_ada_web'],
    ['audit', 'getAuditEvent', 'evt_1003'],
  ] as const)(
    'maps NOT_FOUND for %s through the shared policy',
    async (resource, method, id) => {
      const client = createFixtureAdminDataClient()
      vi.spyOn(client, method).mockRejectedValueOnce(
        adminError('NOT_FOUND', `req_missing_${resource}`)
      )

      await expect(
        loadSecurityDetail(client, resource, id)
      ).resolves.toMatchObject({
        status: 'not-found',
        error: { requestId: `req_missing_${resource}` },
      })
    }
  )

  it('preserves unauthenticated as a distinct state', async () => {
    const client = createFixtureAdminDataClient()
    vi.spyOn(client, 'getAuditEvent').mockRejectedValueOnce(
      adminError('UNAUTHENTICATED', 'req_expired')
    )

    await expect(
      loadSecurityDetail(client, 'audit', 'evt_1003')
    ).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_expired' },
    })
  })

  it('uses stable resource fallback IDs for unknown errors', async () => {
    const client = createFixtureAdminDataClient()
    vi.spyOn(client, 'getSession').mockRejectedValueOnce(
      new Error('private transport detail')
    )
    vi.spyOn(client, 'getAuditEvent').mockRejectedValueOnce('transport failure')

    await expect(
      loadSecurityDetail(client, 'sessions', 'ses_ada_web')
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN', requestId: 'req_admin_detail_sessions' },
    })
    await expect(
      loadSecurityDetail(client, 'audit', 'evt_1003')
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN', requestId: 'req_admin_detail_audit' },
    })
  })

  it('prefers the caller request ID for unknown errors', async () => {
    const client = createFixtureAdminDataClient()
    vi.spyOn(client, 'getSession').mockRejectedValueOnce(new Error('failure'))

    await expect(
      loadSecurityDetail(client, 'sessions', 'ses_ada_web', {
        requestId: 'req_route',
      })
    ).resolves.toMatchObject({
      status: 'error',
      error: { requestId: 'req_route' },
    })
  })
})
