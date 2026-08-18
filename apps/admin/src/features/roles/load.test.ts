import { describe, expect, it, vi } from 'vitest'
import { FixtureAdminDataClient } from '../../lib/fixtures/client'
import { parseRolesSearch } from '../access/search'
import { loadRole, loadRoles } from './load'

describe('loadRoles', () => {
  it('keeps scope selection empty without calling IAM', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listRoles')

    await expect(loadRoles(client, parseRolesSearch({}))).resolves.toEqual({
      status: 'empty',
    })
    expect(list).not.toHaveBeenCalled()
  })

  it('projects scope, query, and opaque pagination', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listRoles')
    const search = parseRolesSearch({
      scopeType: 'site',
      scopeId: 'site_aurora',
      q: 'admin',
    })

    await loadRoles(
      client,
      search,
      { pageToken: 'opaque-token', pageSize: 50 },
      { requestId: 'req_roles' }
    )

    expect(list).toHaveBeenCalledWith(
      {
        scope: { type: 'site', id: 'site_aurora' },
        query: 'admin',
        pageToken: 'opaque-token',
        pageSize: 50,
      },
      { requestId: 'req_roles' }
    )
  })

  it('passes platform scope without inventing an id', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listRoles')
    await loadRoles(client, parseRolesSearch({ scopeType: 'platform' }))

    expect(list.mock.calls[0]?.[0].scope).toEqual({ type: 'platform' })
  })

  it('loads the selected opaque role id through the detail contract', async () => {
    const client = new FixtureAdminDataClient()
    const get = vi.spyOn(client, 'getRole')
    const search = parseRolesSearch({ roleId: 'role_org_admin' })

    const state = await loadRole(client, search, { requestId: 'req_role' })

    expect(get).toHaveBeenCalledWith('role_org_admin', {
      requestId: 'req_role',
    })
    expect(state.status).toBe('ready')
  })

  it('keeps missing selection empty and maps detail errors', async () => {
    const client = new FixtureAdminDataClient()
    const get = vi.spyOn(client, 'getRole')
    await expect(loadRole(client, {})).resolves.toEqual({ status: 'empty' })
    expect(get).not.toHaveBeenCalled()

    get.mockRejectedValueOnce({
      kind: 'admin-data-error',
      code: 'UNAUTHENTICATED',
      fieldViolations: [],
      requestId: 'req_expired',
    })
    await expect(
      loadRole(client, { roleId: 'opaque-role' })
    ).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_expired' },
    })
  })

  it('rejects includeDeleted until the contract supports it', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listRoles')
    const state = await loadRoles(
      client,
      parseRolesSearch({
        scopeType: 'organization',
        scopeId: 'org_aurora',
        includeDeleted: 'true',
      })
    )

    expect(list).not.toHaveBeenCalled()
    expect(state).toMatchObject({
      status: 'error',
      error: {
        code: 'INVALID_ARGUMENT',
        fieldViolations: [
          { path: 'includeDeleted', code: 'UNSUPPORTED_BY_CONTRACT' },
        ],
      },
    })
  })

  it('keeps filtered empty results ready and maps unauthenticated', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listRoles')
    const search = parseRolesSearch({
      scopeType: 'organization',
      scopeId: 'org_aurora',
      q: 'missing',
    })
    list.mockResolvedValueOnce({
      data: { items: [] },
      requestId: 'req_empty',
      schemaVersion: 'kokoro.admin.fixture.v2',
    })
    await expect(loadRoles(client, search)).resolves.toEqual({
      status: 'ready',
      data: { items: [] },
    })

    list.mockRejectedValueOnce({
      kind: 'admin-data-error',
      code: 'UNAUTHENTICATED',
      fieldViolations: [],
      requestId: 'req_expired',
    })
    await expect(loadRoles(client, search)).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_expired' },
    })
  })
})
