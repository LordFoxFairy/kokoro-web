import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  ADMIN_FIXTURE_SCHEMA_VERSION,
  type AdminDataClient,
  type CapabilityProjection,
  type CurrentIdentity,
  type DataResult,
  type RequestContext,
  type Scope,
} from '../../lib/view-models'
import { loadCapabilities, loadCurrentIdentity } from './load'

const identity: CurrentIdentity = {
  id: 'usr_admin',
  displayName: 'Admin User',
  email: 'admin@example.test',
  capabilities: [],
}

function result<T>(data: T, requestId = 'req_result'): DataResult<T> {
  return {
    data,
    requestId,
    schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
  }
}

describe('identity loaders', () => {
  it('loads the current identity and passes request context unchanged', async () => {
    const context: RequestContext = {
      requestId: 'req_identity',
      signal: new AbortController().signal,
    }
    const getCurrentIdentity = vi.fn().mockResolvedValue(result(identity))
    const client = { getCurrentIdentity } satisfies Pick<
      AdminDataClient,
      'getCurrentIdentity'
    >

    const state = await loadCurrentIdentity(client, context)

    expect(getCurrentIdentity).toHaveBeenCalledExactlyOnceWith(context)
    expect(state).toEqual({ status: 'ready', data: identity })
    expectTypeOf(state).toEqualTypeOf<
      Awaited<ReturnType<typeof loadCurrentIdentity>>
    >()
  })

  it.each([
    { type: 'platform' },
    { type: 'organization', id: 'org_aurora' },
    { type: 'site', id: 'site_aurora' },
  ] satisfies readonly Scope[])(
    'projects capabilities for $type scope',
    async (scope) => {
      const context: RequestContext = { requestId: `req_${scope.type}` }
      const projection: CapabilityProjection = {
        schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
        subjectId: identity.id,
        capabilities: [
          { key: 'admin.users.read', scope },
          { key: 'admin.audit.read', scope },
        ],
        projectedAt: '2026-08-18T00:00:00.000Z',
      }
      const getCapabilities = vi.fn().mockResolvedValue(result(projection))
      const client = { getCapabilities } satisfies Pick<
        AdminDataClient,
        'getCapabilities'
      >

      await expect(loadCapabilities(client, scope, context)).resolves.toEqual({
        status: 'ready',
        data: projection,
      })
      expect(getCapabilities).toHaveBeenCalledExactlyOnceWith(scope, context)
    }
  )

  it('keeps an empty capability projection ready', async () => {
    const scope = { type: 'site', id: 'site_without_grants' } satisfies Scope
    const projection: CapabilityProjection = {
      schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
      subjectId: identity.id,
      capabilities: [],
      projectedAt: '2026-08-18T00:00:00.000Z',
    }
    const client = {
      getCapabilities: vi.fn().mockResolvedValue(result(projection)),
    } satisfies Pick<AdminDataClient, 'getCapabilities'>

    await expect(loadCapabilities(client, scope)).resolves.toEqual({
      status: 'ready',
      data: projection,
    })
  })

  it.each([
    ['UNAUTHENTICATED', 'unauthenticated'],
    ['PERMISSION_DENIED', 'forbidden'],
  ] as const)(
    'maps %s without losing the contract request id',
    async (code, status) => {
      const contractError = {
        kind: 'admin-data-error',
        code,
        fieldViolations: [],
        requestId: `req_${code.toLowerCase()}`,
      } as const
      const identityClient = {
        getCurrentIdentity: vi.fn().mockRejectedValue(contractError),
      } satisfies Pick<AdminDataClient, 'getCurrentIdentity'>
      const capabilityClient = {
        getCapabilities: vi.fn().mockRejectedValue(contractError),
      } satisfies Pick<AdminDataClient, 'getCapabilities'>

      await expect(loadCurrentIdentity(identityClient)).resolves.toMatchObject({
        status,
        error: { code, requestId: contractError.requestId },
      })
      await expect(
        loadCapabilities(capabilityClient, { type: 'platform' })
      ).resolves.toMatchObject({
        status,
        error: { code, requestId: contractError.requestId },
      })
    }
  )

  it('uses operation and caller request ids for unknown failures', async () => {
    const identityClient = {
      getCurrentIdentity: vi
        .fn()
        .mockRejectedValue(new Error('transport detail')),
    } satisfies Pick<AdminDataClient, 'getCurrentIdentity'>
    const capabilityClient = {
      getCapabilities: vi.fn().mockRejectedValue(new Error('transport detail')),
    } satisfies Pick<AdminDataClient, 'getCapabilities'>

    await expect(loadCurrentIdentity(identityClient)).resolves.toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN', requestId: 'admin.current-identity' },
    })
    await expect(
      loadCapabilities(
        capabilityClient,
        { type: 'platform' },
        {
          requestId: 'req_capability_fallback',
        }
      )
    ).resolves.toMatchObject({
      status: 'error',
      error: { code: 'UNKNOWN', requestId: 'req_capability_fallback' },
    })
  })
})
