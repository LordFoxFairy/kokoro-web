import { describe, expect, it, vi } from 'vitest'
import { FixtureAdminDataClient } from '../../lib/fixtures/client'
import { loadMembers } from './load'

const scope = { type: 'organization', id: 'org_aurora' } as const

describe('loadMembers', () => {
  it('projects scope and opaque page input', async () => {
    const client = new FixtureAdminDataClient()
    const list = vi.spyOn(client, 'listMembers')
    const page = {
      query: 'ada',
      pageToken: 'opaque-token',
      pageSize: 50,
      sort: { field: 'joinedAt', direction: 'desc' as const },
    }

    await loadMembers(client, scope, page, { requestId: 'req_members' })

    expect(list).toHaveBeenCalledWith(
      { scope, ...page },
      { requestId: 'req_members' }
    )
  })

  it('distinguishes initial empty from filtered empty pages', async () => {
    const client = new FixtureAdminDataClient()
    vi.spyOn(client, 'listMembers').mockResolvedValue({
      data: { items: [], totalCount: 0 },
      requestId: 'req_empty',
      schemaVersion: 'kokoro.admin.fixture.v2',
    })

    await expect(loadMembers(client, scope)).resolves.toEqual({
      status: 'empty',
    })
    await expect(
      loadMembers(client, scope, { query: 'missing' })
    ).resolves.toEqual({
      status: 'ready',
      data: { items: [], totalCount: 0 },
    })
  })

  it('maps unauthenticated distinctly', async () => {
    const client = new FixtureAdminDataClient()
    vi.spyOn(client, 'listMembers').mockRejectedValue({
      kind: 'admin-data-error',
      code: 'UNAUTHENTICATED',
      fieldViolations: [],
      requestId: 'req_expired',
    })

    await expect(loadMembers(client, scope)).resolves.toMatchObject({
      status: 'unauthenticated',
      error: { requestId: 'req_expired' },
    })
  })
})
