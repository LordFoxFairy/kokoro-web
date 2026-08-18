import { describe, expect, it } from 'vitest'
import { isSessionExpired, parseSessionView } from './session'

const validSession = {
  user: {
    id: 'usr_ada',
    displayName: 'Ada Chen',
    email: 'ada@example.test',
  },
  expiresAt: '2026-08-18T18:00:00.000Z',
  capabilities: ['user.read', 'audit.read'],
  scope: { type: 'platform' },
} as const

describe('parseSessionView', () => {
  it('parses the minimal Auth.js session projection', () => {
    expect(parseSessionView(validSession)).toEqual(validSession)
  })

  it('deduplicates capability projection keys in input order', () => {
    expect(
      parseSessionView({
        ...validSession,
        capabilities: ['user.read', 'audit.read', 'user.read'],
      }).capabilities
    ).toEqual(['user.read', 'audit.read'])
  })

  it.each([
    ['top-level token', { ...validSession, accessToken: 'example-token' }],
    [
      'nested credential',
      { ...validSession, user: { ...validSession.user, password: 'secret' } },
    ],
  ])('rejects an unknown %s field', (_label, input) => {
    expect(() => parseSessionView(input)).toThrow()
  })

  it.each([
    { type: 'organization' },
    { type: 'site', id: '' },
    { type: 'platform', id: 'not-allowed' },
  ])('rejects the invalid scope %j', (scope) => {
    expect(() => parseSessionView({ ...validSession, scope })).toThrow()
  })

  it.each([
    '2026-08-18',
    '2026-08-18 18:00:00',
    'not-a-date',
    '2026-13-18T18:00:00Z',
  ])('rejects the invalid ISO expiration %s', (expiresAt) => {
    expect(() => parseSessionView({ ...validSession, expiresAt })).toThrow()
  })
})

describe('isSessionExpired', () => {
  const now = new Date('2026-08-18T17:00:00.000Z')

  it('reports a future session as valid', () => {
    expect(isSessionExpired(parseSessionView(validSession), now)).toBe(false)
  })

  it.each(['2026-08-18T16:59:59.999Z', '2026-08-18T17:00:00.000Z'])(
    'reports an elapsed expiration %s as expired',
    (expiresAt) => {
      expect(
        isSessionExpired(parseSessionView({ ...validSession, expiresAt }), now)
      ).toBe(true)
    }
  )
})
