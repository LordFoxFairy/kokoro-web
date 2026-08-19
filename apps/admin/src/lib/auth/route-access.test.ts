import { describe, expect, it } from 'vitest'
import type { NavCapabilityRules, NavItemId } from '../../config'
import { decideRouteAccess } from './route-access'
import { parseSessionView } from './session'

const itemIds = [
  'dashboard',
  'users',
  'organizations',
  'sites',
  'roles',
  'access',
  'sessions',
  'audit',
] as const satisfies readonly NavItemId[]

const rules = Object.fromEntries(
  itemIds.map((itemId) => [itemId, { allOf: [`admin.${itemId}.read`] }])
) as unknown as NavCapabilityRules

const session = parseSessionView({
  user: {
    id: 'usr_ada',
    displayName: 'Ada Chen',
    email: 'ada@example.test',
  },
  expiresAt: '2026-08-18T18:00:00.000Z',
  capabilities: ['admin.users.read'],
  scope: { type: 'platform' },
})

const baseInput = {
  appOrigin: 'https://admin.kokoro.test',
  capabilityRules: rules,
  now: new Date('2026-08-18T17:00:00.000Z'),
} as const

describe('decideRouteAccess', () => {
  it.each(['/login', '/login/'])(
    'allows the public route %s without a session',
    (pathname) => {
      expect(
        decideRouteAccess({ ...baseInput, pathname, session: null })
      ).toEqual({
        kind: 'allow',
        route: null,
        reason: 'public',
      })
    }
  )

  it.each(['/forbidden', '/forbidden/'])(
    'requires a session for the non-capability route %s',
    (pathname) => {
      expect(
        decideRouteAccess({ ...baseInput, pathname, session: null })
      ).toEqual({ kind: 'login', callbackUrl: pathname })
      expect(
        decideRouteAccess({ ...baseInput, pathname, session })
      ).toMatchObject({
        kind: 'allow',
        reason: 'authorized',
        route: { pattern: '/forbidden', navItemId: null },
      })
    }
  )

  it('returns not-found for an unknown route without guessing authorization', () => {
    expect(
      decideRouteAccess({
        ...baseInput,
        pathname: '/users/usr_1/sessions',
        session: null,
      })
    ).toEqual({ kind: 'not-found' })
  })

  it('sends an unauthenticated request to login with a safe relative callback', () => {
    expect(
      decideRouteAccess({
        ...baseInput,
        pathname: '/users',
        requestedUrl: 'https://admin.kokoro.test/users?page=2#results',
        session: null,
      })
    ).toEqual({
      kind: 'login',
      callbackUrl: '/users?page=2#results',
    })
  })

  it('does not forward an off-origin callback to login', () => {
    expect(
      decideRouteAccess({
        ...baseInput,
        pathname: '/users',
        requestedUrl: 'https://evil.test/phish',
        session: null,
      })
    ).toEqual({ kind: 'login', callbackUrl: '/' })
  })

  it('treats an expired strict session view as unauthenticated', () => {
    expect(
      decideRouteAccess({
        ...baseInput,
        pathname: '/users',
        session,
        now: new Date(session.expiresAt),
      })
    ).toEqual({ kind: 'login', callbackUrl: '/users' })
  })

  it('fails closed when the injected clock is invalid', () => {
    expect(() =>
      decideRouteAccess({
        ...baseInput,
        pathname: '/users',
        session,
        now: new Date(Number.NaN),
      })
    ).toThrow('now must be a valid Date')
  })

  it('allows a known route when its navigation capability rule matches', () => {
    const result = decideRouteAccess({
      ...baseInput,
      pathname: '/users',
      session,
    })

    expect(result).toMatchObject({
      kind: 'allow',
      reason: 'authorized',
      route: { pattern: '/users', navItemId: 'users' },
    })
  })

  it('uses the parent navigation capability for a detail route', () => {
    expect(
      decideRouteAccess({
        ...baseInput,
        pathname: '/users/usr_1',
        session,
      })
    ).toMatchObject({
      kind: 'allow',
      reason: 'authorized',
      route: { pattern: '/users/[id]', navItemId: 'users' },
    })
  })

  it('returns forbidden when the route capability is absent', () => {
    expect(
      decideRouteAccess({
        ...baseInput,
        pathname: '/audit',
        session,
      })
    ).toEqual({ kind: 'forbidden' })
  })
})
