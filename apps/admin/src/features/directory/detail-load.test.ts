import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createFixtureAdminDataClient } from '../../lib/fixtures'
import type { PageState } from '../../lib/page-state'
import type {
  AdminError,
  Organization,
  RequestContext,
  Site,
  User,
} from '../../lib/view-models'
import { loadDirectoryDetail } from './detail-load'

function adminError(code: AdminError['code'], requestId: string): AdminError {
  return {
    kind: 'admin-data-error',
    code,
    fieldViolations: [],
    requestId,
  }
}

describe('loadDirectoryDetail', () => {
  it('loads each resource through its matching client method', async () => {
    const client = createFixtureAdminDataClient()
    const context: RequestContext = {
      requestId: 'req_detail',
      signal: new AbortController().signal,
    }
    const getUser = vi.spyOn(client, 'getUser')
    const getOrganization = vi.spyOn(client, 'getOrganization')
    const getSite = vi.spyOn(client, 'getSite')

    const user = await loadDirectoryDetail(client, 'users', 'usr_ada', context)
    const organization = await loadDirectoryDetail(
      client,
      'organizations',
      'org_aurora',
      context
    )
    const site = await loadDirectoryDetail(
      client,
      'sites',
      'site_aurora_us',
      context
    )

    expect(user).toMatchObject({ status: 'ready', data: { id: 'usr_ada' } })
    expect(organization).toMatchObject({
      status: 'ready',
      data: { id: 'org_aurora' },
    })
    expect(site).toMatchObject({
      status: 'ready',
      data: { id: 'site_aurora_us' },
    })
    expect(getUser).toHaveBeenCalledWith('usr_ada', context)
    expect(getOrganization).toHaveBeenCalledWith('org_aurora', context)
    expect(getSite).toHaveBeenCalledWith('site_aurora_us', context)
    expectTypeOf(user).toEqualTypeOf<PageState<User>>()
    expectTypeOf(organization).toEqualTypeOf<PageState<Organization>>()
    expectTypeOf(site).toEqualTypeOf<PageState<Site>>()
  })

  it.each([
    ['NOT_FOUND', 'not-found'],
    ['PERMISSION_DENIED', 'forbidden'],
    ['UNAVAILABLE', 'error'],
  ] as const)(
    'maps %s through the shared page-state policy',
    async (code, status) => {
      const client = createFixtureAdminDataClient()
      vi.spyOn(client, 'getUser').mockRejectedValueOnce(
        adminError(code, `req_${code.toLowerCase()}`)
      )

      const state = await loadDirectoryDetail(client, 'users', 'usr_ada')

      expect(state).toMatchObject({
        status,
        error: {
          code,
          requestId: `req_${code.toLowerCase()}`,
        },
      })
    }
  )

  it('uses a stable resource fallback request id for unknown failures', async () => {
    const client = createFixtureAdminDataClient()
    vi.spyOn(client, 'getOrganization').mockRejectedValue(
      new Error('private transport detail')
    )

    const first = await loadDirectoryDetail(
      client,
      'organizations',
      'org_aurora'
    )
    const second = await loadDirectoryDetail(
      client,
      'organizations',
      'org_aurora'
    )

    expect(first).toEqual(second)
    expect(first).toEqual({
      status: 'error',
      error: {
        code: 'UNKNOWN',
        fieldViolations: [],
        requestId: 'req_admin_detail_organizations',
        retryable: true,
      },
    })
  })

  it('uses the caller request id as the unknown-error fallback', async () => {
    const client = createFixtureAdminDataClient()
    vi.spyOn(client, 'getSite').mockRejectedValueOnce('transport failure')

    const state = await loadDirectoryDetail(client, 'sites', 'site_aurora_us', {
      requestId: 'req_route_render',
    })

    expect(state).toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN', requestId: 'req_route_render' },
    })
  })

  it('passes opaque entity ids unchanged to the authoritative backend', async () => {
    const client = createFixtureAdminDataClient()
    const getUser = vi.spyOn(client, 'getUser')

    await expect(
      loadDirectoryDetail(client, 'users', ' usr_ada ', {
        requestId: 'req_opaque_id',
      })
    ).resolves.toMatchObject({ status: 'not-found' })
    expect(getUser).toHaveBeenCalledWith(' usr_ada ', {
      requestId: 'req_opaque_id',
    })
  })

  it('preserves unauthenticated as a distinct page state', async () => {
    const client = createFixtureAdminDataClient()
    vi.spyOn(client, 'getUser').mockRejectedValue(
      adminError('UNAUTHENTICATED', 'req_detail_expired')
    )

    await expect(
      loadDirectoryDetail(client, 'users', 'usr_ada')
    ).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_detail_expired' },
    })
  })
})
