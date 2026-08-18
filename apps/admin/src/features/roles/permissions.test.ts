import { describe, expect, it, vi } from 'vitest'
import { FixtureAdminDataClient } from '../../lib/fixtures/client'
import { loadPermissions } from './permissions'

describe('loadPermissions', () => {
  it('keeps an unselected scope empty without calling IAM', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listPermissions')

    await expect(loadPermissions(client, undefined)).resolves.toEqual({
      status: 'empty',
    })
    expect(list).not.toHaveBeenCalled()
  })

  it.each([
    { type: 'platform' } as const,
    { type: 'organization', id: 'org_aurora' } as const,
    { type: 'site', id: 'site_aurora' } as const,
  ])('passes the complete $type scope to the authority', async (scope) => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listPermissions')
    const context = { requestId: `req_permissions_${scope.type}` }

    const state = await loadPermissions(client, scope, context)

    expect(list).toHaveBeenCalledWith(scope, context)
    expect(state.status).toBe('ready')
  })

  it('maps an empty authoritative catalog to empty', async () => {
    const client = new FixtureAdminDataClient()
    vi.spyOn(client, 'listPermissions').mockResolvedValue({
      data: [],
      requestId: 'req_empty',
      schemaVersion: 'kokoro.admin.fixture.v2',
    })

    await expect(
      loadPermissions(client, { type: 'platform' })
    ).resolves.toEqual({ status: 'empty' })
  })

  it('preserves unauthenticated and unknown request ids', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listPermissions')
    list.mockRejectedValueOnce({
      kind: 'admin-data-error',
      code: 'UNAUTHENTICATED',
      fieldViolations: [],
      requestId: 'req_expired',
    })
    await expect(
      loadPermissions(client, { type: 'platform' })
    ).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_expired' },
    })

    list.mockRejectedValueOnce(new Error('private transport detail'))
    await expect(
      loadPermissions(client, { type: 'platform' })
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN', requestId: 'admin.permissions' },
    })
  })
})
