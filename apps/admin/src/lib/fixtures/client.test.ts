import { describe, expect, it } from 'vitest'
import { ADMIN_CONTRACT_VERSION } from '../contracts'
import { FixtureAdminContractClient } from './client'
import {
  FIXTURE_NOW,
  fixtureAudit,
  fixtureCapabilities,
  fixtureMembers,
  fixtureOrganizations,
  fixturePermissions,
  fixtureRoles,
  fixtureSessions,
  fixtureSites,
  fixtureUsers,
} from './data'

const platformScope = { type: 'platform' } as const
const organizationScope = {
  type: 'organization',
  id: 'org_aurora',
} as const
const siteScope = { type: 'site', id: 'site_aurora_us' } as const

describe('FixtureAdminContractClient', () => {
  it('returns deterministic request metadata and fixture data', async () => {
    const firstClient = new FixtureAdminContractClient()
    const secondClient = new FixtureAdminContractClient()

    const first = await firstClient.getCurrentIdentity()
    const second = await firstClient.getDashboard(platformScope)
    const replay = await secondClient.getCurrentIdentity()
    const correlated = await firstClient.getCapabilities(platformScope, {
      requestId: 'req_test_correlation',
    })

    expect(first).toEqual(replay)
    expect(first).toMatchObject({
      requestId: 'req_fixture_0001',
      contractVersion: ADMIN_CONTRACT_VERSION,
      data: {
        id: 'usr_ada',
        displayName: 'Ada Chen',
        email: 'ada@example.test',
        capabilities: fixtureCapabilities,
      },
    })
    expect(second).toMatchObject({
      requestId: 'req_fixture_0002',
      contractVersion: ADMIN_CONTRACT_VERSION,
      data: { generatedAt: FIXTURE_NOW },
    })
    expect(
      second.data.metrics.map(({ key, value }) => ({ key, value }))
    ).toEqual([
      { key: 'users', value: fixtureUsers.length },
      { key: 'organizations', value: fixtureOrganizations.length },
      { key: 'sites', value: fixtureSites.length },
      { key: 'activeSessions', value: 2 },
      { key: 'securityEvents', value: 0 },
    ])
    expect(correlated.requestId).toBe('req_test_correlation')
    expect(correlated.data.capabilities).toEqual(
      fixtureCapabilities.filter(({ scope }) => scope.type === 'platform')
    )
  })

  it('paginates with an opaque resource-bound token', async () => {
    const client = new FixtureAdminContractClient()
    const first = await client.listUsers({ pageSize: 2 })
    const second = await client.listUsers({
      pageSize: 2,
      pageToken: first.data.nextPageToken,
    })

    expect(first.data).toEqual({
      items: fixtureUsers.slice(0, 2),
      nextPageToken: `fixture:${ADMIN_CONTRACT_VERSION}:users:2`,
      totalCount: fixtureUsers.length,
    })
    expect(second.data).toEqual({
      items: fixtureUsers.slice(2, 4),
      nextPageToken: undefined,
      totalCount: fixtureUsers.length,
    })

    await expect(
      client.listOrganizations({ pageToken: first.data.nextPageToken })
    ).rejects.toMatchObject({
      kind: 'admin-contract-error',
      code: 'INVALID_ARGUMENT',
      businessCode: 'INVALID_PAGE_TOKEN',
    })
  })

  it('filters lists by query, status, scope, and domain-specific fields', async () => {
    const client = new FixtureAdminContractClient()

    const users = await client.listUsers({
      query: '  NOAH  ',
      statuses: ['suspended'],
    })
    const organizations = await client.listOrganizations({
      statuses: ['deleted'],
    })
    const sites = await client.listSites({
      query: 'northstar',
      statuses: ['active'],
    })
    const members = await client.listMembers({
      scope: organizationScope,
      query: 'mina',
    })
    const roles = await client.listRoles({ scope: siteScope })
    const sessions = await client.listSessions({
      userId: 'usr_noah',
      statuses: ['revoked'],
    })
    const audit = await client.listAudit({
      actorId: 'usr_mina',
      targetId: 'role_org_auditor',
      requestId: 'req_fixture_1001',
      outcomes: ['success'],
      scope: organizationScope,
      query: 'role.read',
    })

    expect(users.data.items.map(({ id }) => id)).toEqual(['usr_noah'])
    expect(organizations.data.items.map(({ id }) => id)).toEqual([
      'org_archive',
    ])
    expect(sites.data.items.map(({ id }) => id)).toEqual(['site_northstar'])
    expect(members.data.items.map(({ id }) => id)).toEqual(['mem_mina_aurora'])
    expect(roles.data.items.map(({ id }) => id)).toEqual(['role_site_manager'])
    expect(sessions.data.items.map(({ id }) => id)).toEqual(['ses_noah_old'])
    expect(audit.data.items.map(({ id }) => id)).toEqual(['evt_1001'])
  })

  it('sorts supported fields in both directions and rejects unsupported fields', async () => {
    const client = new FixtureAdminContractClient()

    const ascending = await client.listUsers({
      sort: { field: 'displayName', direction: 'asc' },
    })
    const descending = await client.listRoles({
      scope: organizationScope,
      sort: { field: 'memberCount', direction: 'desc' },
    })

    expect(ascending.data.items.map(({ displayName }) => displayName)).toEqual([
      'Ada Chen',
      'Mina Patel',
      'Noah Williams',
      'Yuki Sato',
    ])
    expect(descending.data.items.map(({ id }) => id)).toEqual([
      'role_org_admin',
      'role_org_auditor',
    ])
    await expect(
      client.listSites({ sort: { field: 'organizationId', direction: 'asc' } })
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      businessCode: 'UNSUPPORTED_SORT',
      requestId: 'req_fixture_0003',
    })
  })

  it.each([0, -1, 101, 1.5, Number.NaN])(
    'rejects invalid page size %s',
    async (pageSize) => {
      const client = new FixtureAdminContractClient()

      await expect(client.listUsers({ pageSize })).rejects.toMatchObject({
        kind: 'admin-contract-error',
        code: 'INVALID_ARGUMENT',
        businessCode: 'INVALID_PAGE_SIZE',
        fieldViolations: [],
        requestId: 'req_fixture_0001',
      })
    }
  )

  it('returns each detail domain and reports NOT_FOUND consistently', async () => {
    const client = new FixtureAdminContractClient()

    await expect(client.getUser('usr_ada')).resolves.toMatchObject({
      data: fixtureUsers[0],
    })
    await expect(client.getOrganization('org_aurora')).resolves.toMatchObject({
      data: fixtureOrganizations[0],
    })
    await expect(client.getSite('site_aurora_us')).resolves.toMatchObject({
      data: fixtureSites[0],
    })
    await expect(client.getRole('role_org_admin')).resolves.toMatchObject({
      data: fixtureRoles[0],
    })
    await expect(client.getSession('ses_ada_web')).resolves.toMatchObject({
      data: fixtureSessions[0],
    })
    await expect(client.getAuditEvent('evt_1003')).resolves.toMatchObject({
      data: fixtureAudit[0],
    })
    await expect(client.getUser('usr_missing')).rejects.toMatchObject({
      kind: 'admin-contract-error',
      code: 'NOT_FOUND',
      requestId: 'req_fixture_0007',
      fieldViolations: [],
    })
  })

  it('honors an already-aborted signal for result and detail methods', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = new FixtureAdminContractClient()

    await expect(
      client.getDashboard(platformScope, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED',
      businessCode: 'REQUEST_ABORTED',
      requestId: 'req_fixture_0001',
    })
    await expect(
      client.getUser('usr_ada', {
        signal: controller.signal,
        requestId: 'req_aborted_detail',
      })
    ).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED',
      businessCode: 'REQUEST_ABORTED',
      requestId: 'req_aborted_detail',
    })
  })

  it('exposes permissions and evaluates allowed and denied access diagnostics', async () => {
    const client = new FixtureAdminContractClient()
    const permissions = await client.listPermissions(organizationScope)
    const allowed = await client.checkAccess({
      subjectId: 'usr_ada',
      scope: platformScope,
      resource: 'users',
      action: 'read',
    })
    const denied = await client.checkAccess({
      subjectId: 'usr_ada',
      scope: organizationScope,
      resource: 'users',
      action: 'read',
    })

    expect(permissions.data).toEqual(fixturePermissions)
    expect(allowed.data).toEqual({
      subjectId: 'usr_ada',
      scope: platformScope,
      resource: 'users',
      action: 'read',
      allowed: true,
      checkedAt: FIXTURE_NOW,
      reasonCode: 'FIXTURE_CAPABILITY_PRESENT',
      evidence: ['users.read', 'platform'],
    })
    expect(denied.data).toMatchObject({
      allowed: false,
      reasonCode: 'FIXTURE_CAPABILITY_ABSENT',
      evidence: [],
    })
  })

  it('covers every fixture collection through its list domain', async () => {
    const client = new FixtureAdminContractClient()

    const [users, organizations, sites, members, roles, sessions, audit] =
      await Promise.all([
        client.listUsers(),
        client.listOrganizations(),
        client.listSites(),
        client.listMembers({ scope: organizationScope }),
        client.listRoles({ scope: organizationScope }),
        client.listSessions(),
        client.listAudit(),
      ])

    expect(users.data.items).toEqual(fixtureUsers)
    expect(organizations.data.items).toEqual(fixtureOrganizations)
    expect(sites.data.items).toEqual(fixtureSites)
    expect(members.data.items).toEqual(
      fixtureMembers.filter(({ scope }) => scope.type === 'organization')
    )
    expect(roles.data.items).toEqual(
      fixtureRoles.filter(({ scope }) => scope.type === 'organization')
    )
    expect(sessions.data.items).toEqual(fixtureSessions)
    expect(audit.data.items).toEqual(fixtureAudit)
  })
})
