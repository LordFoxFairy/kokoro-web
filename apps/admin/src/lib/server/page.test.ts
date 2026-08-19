import { describe, expect, it, vi } from 'vitest'
import type { NavCapabilityRules, NavItemId } from '../../config'
import * as identityLoaders from '../../features/identity/load'
import { parseSessionView } from '../auth/session'
import { createFixtureAdminDataClient } from '../fixtures'
import type { PageState } from '../page-state'
import type {
  AdminDataClient,
  AdminError,
  CapabilityProjection,
  CurrentIdentity,
  DataResult,
  Scope,
} from '../view-models'
import { orchestrateAdminPage } from './page'

const rule = (id: NavItemId) => ({ allOf: [`admin.${id}.read`] })
const rules = {
  dashboard: rule('dashboard'),
  users: rule('users'),
  organizations: rule('organizations'),
  sites: rule('sites'),
  roles: rule('roles'),
  access: rule('access'),
  sessions: rule('sessions'),
  audit: rule('audit'),
} satisfies NavCapabilityRules

const session = parseSessionView({
  user: {
    id: 'usr_ada',
    displayName: 'Admin',
    email: 'admin@example.test',
  },
  expiresAt: '2099-01-01T00:00:00.000Z',
  capabilities: ['admin.dashboard.read'],
  scope: { type: 'platform' },
})

const platform = { type: 'platform' } as const satisfies Scope

function adminError(code: AdminError['code'], requestId: string): AdminError {
  return {
    kind: 'admin-data-error',
    code,
    fieldViolations: [],
    requestId,
  }
}

function input<T>(
  client: AdminDataClient,
  loadContent: (
    client: AdminDataClient,
    scope: Scope,
    context?: Parameters<AdminDataClient['getCurrentIdentity']>[0]
  ) => Promise<PageState<T>>,
  overrides: Partial<Parameters<typeof orchestrateAdminPage<T>>[0]> = {}
) {
  return {
    pathname: '/',
    requestedUrl: '/?view=security',
    appOrigin: 'http://admin.example.test',
    session,
    capabilityRules: rules,
    client,
    scope: platform,
    loadContent,
    ...overrides,
  }
}

describe('orchestrateAdminPage', () => {
  it.each([
    ['unauthenticated', { session: null }, 'redirect'],
    ['forbidden', { session: { ...session, capabilities: [] } }, 'forbidden'],
    ['unknown route', { pathname: '/missing' }, 'not-found'],
  ] as const)(
    'returns %s without starting RPC work',
    async (_, overrides, kind) => {
      const client = createFixtureAdminDataClient()
      const identity = vi.spyOn(client, 'getCurrentIdentity')
      const capabilities = vi.spyOn(client, 'getCapabilities')
      const content = vi.fn(async (): Promise<PageState<string>> => ({
        status: 'ready',
        data: 'content',
      }))

      const result = await orchestrateAdminPage(
        input(client, content, overrides as never)
      )

      expect(result.kind).toBe(kind)
      expect(identity).not.toHaveBeenCalled()
      expect(capabilities).not.toHaveBeenCalled()
      expect(content).not.toHaveBeenCalled()
    }
  )

  it('starts identity, capabilities, and content concurrently and preserves inputs', async () => {
    const fixture = createFixtureAdminDataClient()
    const identityResult = await fixture.getCurrentIdentity()
    const capabilityResult = await fixture.getCapabilities(platform)
    let resolveIdentity!: (value: DataResult<CurrentIdentity>) => void
    let resolveCapabilities!: (value: DataResult<CapabilityProjection>) => void
    let resolveContent!: (value: PageState<string>) => void
    const identityPending = new Promise<DataResult<CurrentIdentity>>(
      (resolve) => (resolveIdentity = resolve)
    )
    const capabilitiesPending = new Promise<DataResult<CapabilityProjection>>(
      (resolve) => (resolveCapabilities = resolve)
    )
    const contentPending = new Promise<PageState<string>>(
      (resolve) => (resolveContent = resolve)
    )
    const client = {
      ...fixture,
      getCurrentIdentity: vi.fn(() => identityPending),
      getCapabilities: vi.fn(() => capabilitiesPending),
    } satisfies AdminDataClient
    const loadContent = vi.fn(() => contentPending)
    const context = { requestId: 'req_page_orchestration' }
    const scope = platform

    const pending = orchestrateAdminPage(
      input(client, loadContent, { scope, context })
    )

    expect(client.getCurrentIdentity).toHaveBeenCalledWith(context)
    expect(client.getCapabilities).toHaveBeenCalledWith(scope, context)
    expect(loadContent).toHaveBeenCalledWith(client, scope, context)

    resolveIdentity(identityResult)
    resolveCapabilities(capabilityResult)
    resolveContent({ status: 'ready', data: 'content' })

    await expect(pending).resolves.toMatchObject({
      kind: 'render',
      quality: 'ready',
      content: { status: 'ready', data: 'content' },
    })
  })

  it.each(['identity', 'capabilities', 'content'] as const)(
    'redirects safely when %s reports unauthenticated',
    async (source) => {
      const fixture = createFixtureAdminDataClient()
      const failure = adminError('UNAUTHENTICATED', `req_${source}`)
      const client = {
        ...fixture,
        getCurrentIdentity:
          source === 'identity'
            ? vi.fn(async () => Promise.reject(failure))
            : fixture.getCurrentIdentity.bind(fixture),
        getCapabilities:
          source === 'capabilities'
            ? vi.fn(async () => Promise.reject(failure))
            : fixture.getCapabilities.bind(fixture),
      } satisfies AdminDataClient
      const content = async (): Promise<PageState<string>> =>
        source === 'content'
          ? {
              status: 'unauthenticated',
              error: {
                code: 'UNAUTHENTICATED',
                fieldViolations: [],
                requestId: 'req_content',
                retryable: false,
              },
            }
          : { status: 'ready', data: 'content' }

      const result = await orchestrateAdminPage(
        input(client, content, {
          requestedUrl: 'https://attacker.example/steal',
        })
      )

      expect(result).toEqual({
        kind: 'redirect',
        reason: 'unauthenticated',
        source,
        destination: '/login',
        callbackUrl: '/',
      })
    }
  )

  it.each(['capabilities', 'content'] as const)(
    'prioritizes %s unauthenticated over a mismatched ready identity',
    async (source) => {
      const fixture = createFixtureAdminDataClient()
      const identityResult = await fixture.getCurrentIdentity()
      const failure = adminError('UNAUTHENTICATED', `req_${source}`)
      const client = {
        ...fixture,
        getCurrentIdentity: vi.fn(async () => ({
          ...identityResult,
          data: { ...identityResult.data, id: 'usr_other' },
        })),
        getCapabilities:
          source === 'capabilities'
            ? vi.fn(async () => Promise.reject(failure))
            : fixture.getCapabilities.bind(fixture),
      } satisfies AdminDataClient
      const content = async (): Promise<PageState<string>> =>
        source === 'content'
          ? {
              status: 'unauthenticated',
              error: {
                code: 'UNAUTHENTICATED',
                fieldViolations: [],
                requestId: 'req_content',
                retryable: false,
              },
            }
          : { status: 'ready', data: 'content' }

      await expect(
        orchestrateAdminPage(input(client, content))
      ).resolves.toEqual({
        kind: 'redirect',
        reason: 'unauthenticated',
        source,
        destination: '/login',
        callbackUrl: '/?view=security',
      })
    }
  )

  it.each(['identity', 'capabilities', 'content'] as const)(
    'returns forbidden when %s reports permission denied',
    async (source) => {
      const fixture = createFixtureAdminDataClient()
      const failure = adminError('PERMISSION_DENIED', `req_${source}`)
      const client = {
        ...fixture,
        getCurrentIdentity:
          source === 'identity'
            ? vi.fn(async () => Promise.reject(failure))
            : fixture.getCurrentIdentity.bind(fixture),
        getCapabilities:
          source === 'capabilities'
            ? vi.fn(async () => Promise.reject(failure))
            : fixture.getCapabilities.bind(fixture),
      } satisfies AdminDataClient
      const content = async (): Promise<PageState<string>> =>
        source === 'content'
          ? {
              status: 'forbidden',
              error: {
                code: 'PERMISSION_DENIED',
                fieldViolations: [],
                requestId: 'req_content',
                retryable: false,
              },
            }
          : { status: 'ready', data: 'content' }

      await expect(
        orchestrateAdminPage(input(client, content))
      ).resolves.toEqual({
        kind: 'forbidden',
        reason: source,
      })
    }
  )

  it.each(['capabilities', 'content'] as const)(
    'prioritizes %s forbidden over a mismatched ready identity',
    async (source) => {
      const fixture = createFixtureAdminDataClient()
      const identityResult = await fixture.getCurrentIdentity()
      const failure = adminError('PERMISSION_DENIED', `req_${source}`)
      const client = {
        ...fixture,
        getCurrentIdentity: vi.fn(async () => ({
          ...identityResult,
          data: { ...identityResult.data, id: 'usr_other' },
        })),
        getCapabilities:
          source === 'capabilities'
            ? vi.fn(async () => Promise.reject(failure))
            : fixture.getCapabilities.bind(fixture),
      } satisfies AdminDataClient
      const content = async (): Promise<PageState<string>> =>
        source === 'content'
          ? {
              status: 'forbidden',
              error: {
                code: 'PERMISSION_DENIED',
                fieldViolations: [],
                requestId: 'req_content',
                retryable: false,
              },
            }
          : { status: 'ready', data: 'content' }

      await expect(
        orchestrateAdminPage(input(client, content))
      ).resolves.toEqual({ kind: 'forbidden', reason: source })
    }
  )

  it('only turns a content not-found into the page not-found outcome', async () => {
    const fixture = createFixtureAdminDataClient()
    const notFound = adminError('NOT_FOUND', 'req_identity')
    const client = {
      ...fixture,
      getCurrentIdentity: vi.fn(async () => Promise.reject(notFound)),
    } satisfies AdminDataClient

    const shellFailure = await orchestrateAdminPage(
      input(client, async () => ({ status: 'ready', data: 'content' }))
    )
    expect(shellFailure).toMatchObject({ kind: 'render', quality: 'failed' })

    const contentNotFound = await orchestrateAdminPage(
      input(fixture, async () => ({
        status: 'not-found',
        error: {
          code: 'NOT_FOUND',
          fieldViolations: [],
          requestId: 'req_content',
          retryable: false,
        },
      }))
    )
    expect(contentNotFound).toEqual({ kind: 'not-found', reason: 'content' })
  })

  it('preserves partial content data and marks the render partial', async () => {
    const fixture = createFixtureAdminDataClient()
    const content: PageState<{ stable: string }> = {
      status: 'partial',
      data: { stable: 'available' },
      error: {
        code: 'UNAVAILABLE',
        businessCode: 'DASHBOARD_PARTIAL',
        fieldViolations: [],
        requestId: 'req_partial',
        retryable: true,
      },
    }

    const result = await orchestrateAdminPage(
      input(fixture, async () => content)
    )

    expect(result).toMatchObject({
      kind: 'render',
      quality: 'partial',
      content,
    })
  })

  it('treats empty content as a successful render and ordinary errors as failed', async () => {
    const fixture = createFixtureAdminDataClient()
    const empty = await orchestrateAdminPage(
      input(fixture, async (): Promise<PageState<string>> => ({
        status: 'empty',
      }))
    )
    expect(empty).toMatchObject({ kind: 'render', quality: 'ready' })

    const failed = await orchestrateAdminPage(
      input(fixture, async (): Promise<PageState<string>> => ({
        status: 'error',
        error: {
          code: 'UNAVAILABLE',
          fieldViolations: [],
          requestId: 'req_failed',
          retryable: true,
        },
      }))
    )
    expect(failed).toMatchObject({ kind: 'render', quality: 'failed' })
  })

  it.each([
    ['identity', 'usr_other', 'usr_ada'],
    ['capabilities', 'usr_ada', 'usr_other'],
  ] as const)(
    'fails closed without retaining data when the %s subject differs from the session',
    async (_source, identityId, capabilitySubjectId) => {
      const fixture = createFixtureAdminDataClient()
      const identityResult = await fixture.getCurrentIdentity()
      const capabilityResult = await fixture.getCapabilities(platform)
      const client = {
        ...fixture,
        getCurrentIdentity: vi.fn(async () => ({
          ...identityResult,
          data: { ...identityResult.data, id: identityId },
        })),
        getCapabilities: vi.fn(async () => ({
          ...capabilityResult,
          data: {
            ...capabilityResult.data,
            subjectId: capabilitySubjectId,
          },
        })),
      } satisfies AdminDataClient

      const result = await orchestrateAdminPage(
        input(client, async () => ({
          status: 'ready',
          data: { secret: 'must-not-cross-boundary' },
        }))
      )

      expect(result).toEqual({
        kind: 'render',
        route: expect.objectContaining({ pattern: '/' }),
        quality: 'failed',
        identity: {
          status: 'error',
          error: {
            code: 'FAILED_PRECONDITION',
            fieldViolations: [],
            requestId: 'admin.subject-consistency',
            retryable: false,
          },
        },
        capabilities: {
          status: 'error',
          error: {
            code: 'FAILED_PRECONDITION',
            fieldViolations: [],
            requestId: 'admin.subject-consistency',
            retryable: false,
          },
        },
        content: {
          status: 'error',
          error: {
            code: 'FAILED_PRECONDITION',
            fieldViolations: [],
            requestId: 'admin.subject-consistency',
            retryable: false,
          },
        },
      })
      expect(JSON.stringify(result)).not.toContain('usr_other')
      expect(JSON.stringify(result)).not.toContain('must-not-cross-boundary')
    }
  )

  it('fails subject consistency before exposing a content not-found outcome', async () => {
    const fixture = createFixtureAdminDataClient()
    const identityResult = await fixture.getCurrentIdentity()
    const client = {
      ...fixture,
      getCurrentIdentity: vi.fn(async () => ({
        ...identityResult,
        data: { ...identityResult.data, id: 'usr_other' },
      })),
    } satisfies AdminDataClient

    const result = await orchestrateAdminPage(
      input(client, async () => ({
        status: 'not-found',
        error: {
          code: 'NOT_FOUND',
          fieldViolations: [],
          requestId: 'req_content_not_found',
          retryable: false,
        },
      }))
    )

    expect(result).toMatchObject({
      kind: 'render',
      quality: 'failed',
      identity: {
        status: 'error',
        error: { code: 'FAILED_PRECONDITION' },
      },
      capabilities: {
        status: 'error',
        error: { code: 'FAILED_PRECONDITION' },
      },
      content: {
        status: 'error',
        error: { code: 'FAILED_PRECONDITION' },
      },
    })
    expect(JSON.stringify(result)).not.toContain('usr_other')
    expect(JSON.stringify(result)).not.toContain('req_content_not_found')
  })

  it.each(['identity', 'capabilities'] as const)(
    'checks partial %s data before rendering it',
    async (mismatchSource) => {
      const fixture = createFixtureAdminDataClient()
      const identityResult = await fixture.getCurrentIdentity()
      const capabilityResult = await fixture.getCapabilities(platform)
      const partialError = {
        code: 'UNAVAILABLE',
        fieldViolations: [],
        requestId: 'req_partial_shell',
        retryable: true,
      } as const
      const identitySpy = vi
        .spyOn(identityLoaders, 'loadCurrentIdentity')
        .mockResolvedValueOnce({
          status: 'partial',
          data: {
            ...identityResult.data,
            id: mismatchSource === 'identity' ? 'usr_other' : 'usr_ada',
          },
          error: partialError,
        })
      const capabilitiesSpy = vi
        .spyOn(identityLoaders, 'loadCapabilities')
        .mockResolvedValueOnce({
          status: 'partial',
          data: {
            ...capabilityResult.data,
            subjectId:
              mismatchSource === 'capabilities' ? 'usr_other' : 'usr_ada',
          },
          error: partialError,
        })

      const result = await orchestrateAdminPage(
        input(fixture, async () => ({ status: 'ready', data: 'content' }))
      )

      expect(result).toMatchObject({
        kind: 'render',
        quality: 'failed',
        identity: { status: 'error' },
        capabilities: { status: 'error' },
        content: { status: 'error' },
      })
      expect(JSON.stringify(result)).not.toContain('usr_other')
      identitySpy.mockRestore()
      capabilitiesSpy.mockRestore()
    }
  )
})
