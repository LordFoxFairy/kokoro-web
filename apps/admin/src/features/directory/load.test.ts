import { describe, expect, it, vi } from 'vitest'
import { FixtureAdminDataClient } from '../../lib/fixtures/client'
import type { Page, User } from '../../lib/view-models'
import { loadDirectory } from './load'
import { parseDirectorySearch } from './search'

describe('loadDirectory', () => {
  it('strictly projects user search into the backend request', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listUsers')
    const context = { requestId: 'req_users' }

    await loadDirectory(
      client,
      'users',
      parseDirectorySearch('users', {
        q: 'ada',
        status: 'active',
        sort: 'email',
        dir: 'asc',
        pageToken: 'next-token',
        pageSize: '50',
      }),
      context
    )

    expect(list).toHaveBeenCalledWith(
      {
        query: 'ada',
        statuses: ['active'],
        sort: { field: 'email', direction: 'asc' },
        pageToken: 'next-token',
        pageSize: 50,
      },
      context
    )
  })

  it('leaves the all-status meaning to the backend contract', async () => {
    const client = new FixtureAdminDataClient()
    const users = vi.spyOn(client, 'listUsers')
    const organizations = vi.spyOn(client, 'listOrganizations')
    const sites = vi.spyOn(client, 'listSites')

    await loadDirectory(client, 'users', parseDirectorySearch('users', {}))
    await loadDirectory(
      client,
      'organizations',
      parseDirectorySearch('organizations', {})
    )
    await loadDirectory(client, 'sites', parseDirectorySearch('sites', {}))

    for (const list of [users, organizations, sites]) {
      expect(list.mock.calls[0]?.[0]?.statuses).toBeUndefined()
    }
  })

  it.each(['all', 'active', 'deleted'] as const)(
    'rejects includeDeleted with status %s when the contract cannot express it',
    async (status) => {
      const client = new FixtureAdminDataClient()
      const list = vi.spyOn(client, 'listOrganizations')

      const state = await loadDirectory(
        client,
        'organizations',
        parseDirectorySearch('organizations', {
          includeDeleted: 'true',
          status,
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
    }
  )

  it('passes an explicitly selected deleted status without inferring lifecycle rules', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listUsers')

    const state = await loadDirectory(
      client,
      'users',
      parseDirectorySearch('users', { status: 'deleted' }),
      { requestId: 'req_deleted' }
    )

    expect(list.mock.calls[0]?.[0]?.statuses).toEqual(['deleted'])
    expect(state.status).toBe('ready')
  })

  it('rejects the unsupported site organization filter without a client-side fallback', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listSites')

    const state = await loadDirectory(
      client,
      'sites',
      parseDirectorySearch('sites', { organizationId: 'org_aurora' })
    )

    expect(list).not.toHaveBeenCalled()
    expect(state).toMatchObject({
      status: 'error',
      error: {
        code: 'INVALID_ARGUMENT',
        requestId: 'admin.directory.sites',
        fieldViolations: [
          {
            path: 'organizationId',
            code: 'UNSUPPORTED_BY_CONTRACT',
          },
        ],
      },
    })
  })

  it('returns empty for a backend page with no items', async () => {
    const client = new FixtureAdminDataClient()
    vi.spyOn(client, 'listUsers').mockResolvedValue({
      data: { items: [] },
      requestId: 'req_empty',
      schemaVersion: 'kokoro.admin.fixture.v2',
    })

    await expect(
      loadDirectory(client, 'users', parseDirectorySearch('users', {}))
    ).resolves.toEqual({ status: 'empty' })
  })

  it('retains an empty backend page for filtered and paged results', async () => {
    const client = new FixtureAdminDataClient()
    const page = { items: [], totalCount: 0 }
    vi.spyOn(client, 'listUsers').mockResolvedValue({
      data: page,
      requestId: 'req_filtered_empty',
      schemaVersion: 'kokoro.admin.fixture.v2',
    })

    await expect(
      loadDirectory(
        client,
        'users',
        parseDirectorySearch('users', { q: 'missing', pageToken: 'opaque' })
      )
    ).resolves.toEqual({ status: 'ready', data: page })
  })

  it('preserves unauthenticated as a distinct page state', async () => {
    const client = new FixtureAdminDataClient()
    vi.spyOn(client, 'listUsers').mockRejectedValue({
      kind: 'admin-data-error',
      code: 'UNAUTHENTICATED',
      fieldViolations: [],
      requestId: 'req_session_expired',
    })

    await expect(
      loadDirectory(client, 'users', parseDirectorySearch('users', {}))
    ).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_session_expired' },
    })
  })

  it('returns the untouched backend page as ready data', async () => {
    const client = new FixtureAdminDataClient()
    const page: Page<User> = {
      items: [
        {
          id: 'usr_1',
          displayName: 'Ada',
          email: 'ada@example.test',
          status: 'active',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
      nextPageToken: 'opaque',
      totalCount: 42,
    }
    vi.spyOn(client, 'listUsers').mockResolvedValue({
      data: page,
      requestId: 'req_ready',
      schemaVersion: 'kokoro.admin.fixture.v2',
    })

    await expect(
      loadDirectory(client, 'users', parseDirectorySearch('users', {}))
    ).resolves.toEqual({ status: 'ready', data: page })
  })

  it('maps thrown data errors and gives unknown errors a stable request id', async () => {
    const client = new FixtureAdminDataClient()
    vi.spyOn(client, 'listOrganizations').mockRejectedValueOnce({
      kind: 'admin-data-error',
      code: 'PERMISSION_DENIED',
      fieldViolations: [],
      requestId: 'req_backend',
    })

    await expect(
      loadDirectory(
        client,
        'organizations',
        parseDirectorySearch('organizations', {})
      )
    ).resolves.toMatchObject({
      status: 'forbidden',
      error: { requestId: 'req_backend' },
    })

    vi.spyOn(client, 'listOrganizations').mockRejectedValueOnce(
      new Error('private transport details')
    )
    await expect(
      loadDirectory(
        client,
        'organizations',
        parseDirectorySearch('organizations', {})
      )
    ).resolves.toMatchObject({
      status: 'error',
      error: {
        code: 'UNKNOWN',
        requestId: 'admin.directory.organizations',
      },
    })
  })
})
