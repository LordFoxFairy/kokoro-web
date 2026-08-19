import { describe, expect, it } from 'vitest'
import { parseAuthSessionView } from './auth-session'

const now = new Date('2026-08-19T12:00:00.000Z')
const validSession = {
  user: {
    id: 'usr_ada',
    name: 'Ada Chen',
    displayName: 'Ada Chen',
    email: 'ada@example.test',
    image: null,
    capabilities: ['users.read', 'users.read', 'audit.read'],
    scope: { type: 'platform' },
  },
  expires: '2026-08-19T13:00:00.000Z',
}

describe('parseAuthSessionView', () => {
  it('projects a strict Auth.js session into the browser-safe SessionView', () => {
    expect(parseAuthSessionView(validSession, now)).toEqual({
      user: {
        id: 'usr_ada',
        displayName: 'Ada Chen',
        email: 'ada@example.test',
      },
      expiresAt: '2026-08-19T13:00:00.000Z',
      capabilities: ['users.read', 'audit.read'],
      scope: { type: 'platform' },
    })
  })

  it('returns null for an expired session', () => {
    expect(
      parseAuthSessionView(
        { ...validSession, expires: '2026-08-19T12:00:00.000Z' },
        now
      )
    ).toBeNull()
  })

  it.each([
    null,
    {},
    { ...validSession, token: 'must-not-survive' },
    {
      ...validSession,
      user: { ...validSession.user, backendToken: 'must-not-survive' },
    },
    { ...validSession, user: null },
    { ...validSession, expires: 'not-a-date' },
  ])('returns null for an invalid Auth.js session %#', (session) => {
    expect(parseAuthSessionView(session, now)).toBeNull()
  })
})
