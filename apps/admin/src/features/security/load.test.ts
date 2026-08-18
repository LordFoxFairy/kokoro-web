import { describe, expect, it, vi } from 'vitest'
import { FixtureAdminDataClient } from '../../lib/fixtures/client'
import { loadAudit, loadSessions } from './load'
import { parseAuditSearch, parseSessionsSearch } from './search'

describe('security loaders', () => {
  it('projects session filters and opaque pagination', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listSessions')
    await loadSessions(
      client,
      parseSessionsSearch({
        q: 'browser',
        userId: 'usr_ada',
        status: ['active', 'revoked'],
      }),
      { pageToken: 'opaque-token', pageSize: 50 }
    )

    expect(list).toHaveBeenCalledWith(
      {
        query: 'browser',
        userId: 'usr_ada',
        statuses: ['active', 'revoked'],
        pageToken: 'opaque-token',
        pageSize: 50,
      },
      undefined
    )
  })

  it('projects audit filters including a single scope', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listAudit')
    await loadAudit(
      client,
      parseAuditSearch({
        actorId: 'usr_ada',
        targetId: 'usr_ben',
        requestId: 'req_source',
        outcome: 'denied,failure',
        scopeType: 'site',
        scopeId: 'site_aurora',
      }),
      { pageToken: 'opaque-token', pageSize: 20 }
    )

    expect(list).toHaveBeenCalledWith(
      {
        query: undefined,
        actorId: 'usr_ada',
        targetId: 'usr_ben',
        requestId: 'req_source',
        outcomes: ['denied', 'failure'],
        scope: { type: 'site', id: 'site_aurora' },
        pageToken: 'opaque-token',
        pageSize: 20,
      },
      undefined
    )
  })

  it.each([
    [{ scopeType: ['site', 'organization'], scopeId: 'scope_1' }, 'scopeType'],
    [{ scopeId: 'scope_1' }, 'scopeType'],
    [{ scopeType: 'site' }, 'scopeId'],
    [{ scopeType: 'platform', scopeId: 'unexpected' }, 'scopeId'],
  ] as const)('rejects unsupported audit scope %o', async (input, path) => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listAudit')
    const state = await loadAudit(client, parseAuditSearch(input))

    expect(list).not.toHaveBeenCalled()
    expect(state).toMatchObject({
      status: 'error',
      error: { fieldViolations: [{ path, code: 'UNSUPPORTED_BY_CONTRACT' }] },
    })
  })

  it('distinguishes initial empty, filtered empty, and unauthenticated', async () => {
    const client = new FixtureAdminDataClient()
    const sessions = vi.spyOn(client, 'listSessions')
    sessions.mockResolvedValue({
      data: { items: [] },
      requestId: 'req_empty',
      schemaVersion: 'kokoro.admin.fixture.v2',
    })
    await expect(
      loadSessions(client, parseSessionsSearch({}))
    ).resolves.toEqual({ status: 'empty' })
    await expect(
      loadSessions(client, parseSessionsSearch({ q: 'missing' }))
    ).resolves.toEqual({ status: 'ready', data: { items: [] } })

    sessions.mockRejectedValueOnce({
      kind: 'admin-data-error',
      code: 'UNAUTHENTICATED',
      fieldViolations: [],
      requestId: 'req_expired',
    })
    await expect(
      loadSessions(client, parseSessionsSearch({}))
    ).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_expired' },
    })
  })
})
