import { describe, expect, it } from 'vitest'
import { createAdminDataClient } from '../data-source'
import { parseAdminEnv, type AdminEnv } from '../env'
import { ADMIN_FIXTURE_SCHEMA_VERSION } from '../view-models'
import { FixtureAdminDataClient } from './client'
import {
  createScenarioFixtureAdminDataClient,
  FixtureScenarioConfigurationError,
  isFixturePartialDashboardResult,
} from './scenario'

const platformScope = { type: 'platform' } as const

function fixtureEnv(nodeEnv: 'development' | 'test' = 'test') {
  return parseAdminEnv({
    NODE_ENV: nodeEnv,
    NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
    ADMIN_DATA_SOURCE: 'fixture',
  })
}

describe('ScenarioFixtureAdminDataClient', () => {
  it('rejects production scenarios through the central data source boundary', () => {
    expect(() =>
      createScenarioFixtureAdminDataClient(
        {
          NODE_ENV: 'development',
          NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100',
          ADMIN_DATA_SOURCE: 'fixture',
        } as AdminEnv,
        { listUsers: 'empty' }
      )
    ).toThrowError(
      expect.objectContaining({
        name: 'FixtureScenarioConfigurationError',
        code: 'INVALID_FIXTURE_SCENARIO',
      })
    )
  })

  it('rejects scenarios that cannot be represented by an operation', () => {
    expect(() =>
      createScenarioFixtureAdminDataClient(fixtureEnv(), {
        listUsers: 'partial',
      })
    ).toThrow(FixtureScenarioConfigurationError)
    expect(() =>
      createScenarioFixtureAdminDataClient(fixtureEnv(), { getUser: 'empty' })
    ).toThrowError(
      expect.objectContaining({ code: 'INVALID_FIXTURE_SCENARIO' })
    )
  })

  it('fails fast for unknown operations and scenario names', () => {
    expect(() =>
      createScenarioFixtureAdminDataClient(fixtureEnv(), {
        unknownMethod: 'empty',
      } as never)
    ).toThrow('Unknown fixture operation: unknownMethod')
    expect(() =>
      createScenarioFixtureAdminDataClient(fixtureEnv(), {
        listUsers: 'typo',
      } as never)
    ).toThrow('Unknown fixture scenario for listUsers: typo')
  })

  it('delegates ready and unconfigured operations to the base client', async () => {
    const baseline = new FixtureAdminDataClient()
    const client = createScenarioFixtureAdminDataClient(
      fixtureEnv(),
      { listUsers: 'ready' },
      new FixtureAdminDataClient()
    )

    await expect(client.listUsers()).resolves.toEqual(
      await baseline.listUsers()
    )
    await expect(client.getUser('usr_ada')).resolves.toEqual(
      await baseline.getUser('usr_ada')
    )
  })

  it('returns deterministic empty results without deriving a scenario from request data', async () => {
    const client = createAdminDataClient(fixtureEnv('development'), {
      fixtureScenarios: {
        getCapabilities: 'empty',
        getDashboard: 'empty',
        listUsers: 'empty',
        listPermissions: 'empty',
      },
    })

    const [users, repeated, capabilities, dashboard, permissions] =
      await Promise.all([
        client.listUsers({ query: 'forbidden', pageToken: 'user-input' }),
        client.listUsers({ query: 'ready' }),
        client.getCapabilities(platformScope),
        client.getDashboard(platformScope),
        client.listPermissions(platformScope),
      ])
    expect(users).toEqual({
      data: { items: [], totalCount: 0 },
      requestId: 'req_fixture_listUsers_empty',
      schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
    })
    expect(repeated).toEqual(users)
    expect(capabilities.data.capabilities).toEqual([])
    expect(dashboard.data).toMatchObject({ metrics: [], recentAudit: [] })
    expect(permissions.data).toEqual([])
  })

  it.each([
    ['forbidden', 'PERMISSION_DENIED'],
    ['not-found', 'NOT_FOUND'],
    ['unavailable', 'UNAVAILABLE'],
  ] as const)(
    'injects %s only into its configured operation',
    async (scenario, code) => {
      const client = createAdminDataClient(fixtureEnv(), {
        fixtureScenarios: { getUser: scenario },
      })

      await expect(
        client.getUser('arbitrary-user-input', {
          requestId: 'req_correlation',
        })
      ).rejects.toMatchObject({
        kind: 'admin-data-error',
        code,
        requestId: 'req_correlation',
        fieldViolations: [],
      })
      await expect(client.listUsers()).resolves.toMatchObject({
        data: { totalCount: 4 },
        schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
      })
    }
  )

  it('expresses a partial Dashboard with an explicit missing section', async () => {
    const client = createAdminDataClient(fixtureEnv(), {
      fixtureScenarios: { getDashboard: 'partial' },
    })

    const response = await client.getDashboard(platformScope, {
      requestId: 'req_dashboard_partial',
    })

    expect(response).toMatchObject({
      requestId: 'req_dashboard_partial',
      schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
      data: { recentAudit: [] },
      fixtureScenario: {
        kind: 'partial',
        missingSections: ['recentAudit'],
      },
    })
    expect(response.data.metrics).not.toHaveLength(0)
    expect(isFixturePartialDashboardResult(response)).toBe(true)
    if (isFixturePartialDashboardResult(response)) {
      expect(response.fixtureScenario.missingSections).toEqual(['recentAudit'])
    }
  })

  it('does not narrow malformed partial metadata', async () => {
    const base = await new FixtureAdminDataClient().getDashboard(platformScope)

    expect(
      isFixturePartialDashboardResult({
        ...base,
        fixtureScenario: { kind: 'partial' },
      } as never)
    ).toBe(false)
    expect(
      isFixturePartialDashboardResult({
        ...base,
        fixtureScenario: {
          kind: 'partial',
          missingSections: ['unknown'],
        },
      } as never)
    ).toBe(false)
    expect(
      isFixturePartialDashboardResult({
        ...base,
        fixtureScenario: { kind: 'partial', missingSections: [] },
      } as never)
    ).toBe(false)
    expect(
      isFixturePartialDashboardResult({
        ...base,
        fixtureScenario: {
          kind: 'partial',
          missingSections: ['recentAudit', 'recentAudit'],
        },
      } as never)
    ).toBe(false)
  })

  it('does not reinterpret access checks or other request inputs as scenario selectors', async () => {
    const client = createAdminDataClient(fixtureEnv(), {
      fixtureScenarios: { listAudit: 'unavailable' },
    })

    await expect(
      client.checkAccess({
        subjectId: 'usr_ada',
        scope: platformScope,
        resource: 'users',
        action: 'read',
      })
    ).resolves.toMatchObject({ data: { allowed: true } })
    await expect(
      client.listAudit({ query: 'ready', requestId: 'not-found' })
    ).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      requestId: 'req_fixture_listAudit_unavailable',
    })
  })

  it('preserves cancellation ahead of an injected result', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = createAdminDataClient(fixtureEnv(), {
      fixtureScenarios: { listUsers: 'empty' },
    })

    await expect(
      client.listUsers(undefined, {
        signal: controller.signal,
        requestId: 'req_cancelled_fixture',
      })
    ).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED',
      businessCode: 'REQUEST_ABORTED',
      requestId: 'req_cancelled_fixture',
    })
  })

  it('preserves cancellation for ready operations', async () => {
    const controller = new AbortController()
    controller.abort()
    const client = createAdminDataClient(fixtureEnv(), {
      fixtureScenarios: { listUsers: 'ready' },
    })

    await expect(
      client.listUsers(undefined, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'DEADLINE_EXCEEDED',
      businessCode: 'REQUEST_ABORTED',
    })
  })
})
