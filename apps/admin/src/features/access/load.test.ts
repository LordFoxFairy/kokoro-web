import { describe, expect, it, vi } from 'vitest'
import { FixtureAdminDataClient } from '../../lib/fixtures/client'
import { loadAccess } from './load'
import { parseAccessSearch } from './search'

describe('loadAccess', () => {
  it('keeps an incomplete diagnostic form empty without calling IAM', async () => {
    const client = new FixtureAdminDataClient()
    const check = vi.spyOn(client, 'checkAccess')

    await expect(loadAccess(client, parseAccessSearch({}))).resolves.toEqual({
      status: 'empty',
    })
    expect(check).not.toHaveBeenCalled()
  })

  it('projects a complete diagnostic input without evaluating access locally', async () => {
    const client = new FixtureAdminDataClient()
    const check = vi.spyOn(client, 'checkAccess')
    const search = parseAccessSearch({
      subjectId: 'usr_ada',
      scopeType: 'organization',
      scopeId: 'org_aurora',
      resource: 'users',
      action: 'read',
    })

    const state = await loadAccess(client, search, { requestId: 'req_access' })

    expect(check).toHaveBeenCalledWith(
      {
        subjectId: 'usr_ada',
        scope: { type: 'organization', id: 'org_aurora' },
        resource: 'users',
        action: 'read',
      },
      { requestId: 'req_access' }
    )
    expect(state.status).toBe('ready')
  })

  it('passes platform scope without inventing an id', async () => {
    const client = new FixtureAdminDataClient()
    const check = vi.spyOn(client, 'checkAccess')
    const state = await loadAccess(
      client,
      parseAccessSearch({
        subjectId: 'usr_ada',
        scopeType: 'platform',
        resource: 'users',
        action: 'read',
      })
    )

    expect(check.mock.calls[0]?.[0].scope).toEqual({ type: 'platform' })
    expect(state.status).toBe('ready')
  })

  it('preserves unauthenticated and unknown error request ids', async () => {
    const client = new FixtureAdminDataClient()
    const check = vi.spyOn(client, 'checkAccess')
    const search = parseAccessSearch({
      subjectId: 'usr_ada',
      scopeType: 'site',
      scopeId: 'site_aurora',
      resource: 'site.member',
      action: 'read',
    })
    check.mockRejectedValueOnce({
      kind: 'admin-data-error',
      code: 'UNAUTHENTICATED',
      fieldViolations: [],
      requestId: 'req_expired',
    })
    await expect(loadAccess(client, search)).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_expired' },
    })

    check.mockRejectedValueOnce(new Error('private transport detail'))
    await expect(loadAccess(client, search)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN', requestId: 'admin.access' },
    })
  })
})
