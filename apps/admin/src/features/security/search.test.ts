import { describe, expect, it } from 'vitest'
import {
  parseAuditSearchParams,
  parseSessionSearchParams,
  serializeAuditSearchParams,
  serializeSessionSearchParams,
} from './search'

describe('session search params', () => {
  it('roundtrips supported filters and repeated status values', () => {
    const search = {
      q: 'browser',
      userId: 'user-1',
      status: ['active', 'revoked'] as const,
    }

    expect(
      parseSessionSearchParams(serializeSessionSearchParams(search))
    ).toEqual(search)
  })

  it('drops empty, invalid, duplicate, unknown, and pagination values', () => {
    expect(
      parseSessionSearchParams({
        q: '   ',
        userId: ['', ' user-2 '],
        status: ['active', 'invalid', 'active', 'revoked,expired'],
        pageToken: 'sensitive-cursor',
        extra: 'ignored',
      })
    ).toEqual({
      userId: 'user-2',
      status: ['active', 'revoked', 'expired'],
    })
  })
})

describe('audit search params', () => {
  it('roundtrips all supported filters and multi-select values', () => {
    const search = {
      q: 'role.updated',
      actorId: 'actor-1',
      targetId: 'role-2',
      requestId: 'request-3',
      outcome: ['success', 'denied'] as const,
      scopeType: ['organization', 'site'] as const,
      scopeId: 'site-4',
    }

    expect(parseAuditSearchParams(serializeAuditSearchParams(search))).toEqual(
      search
    )
  })

  it('safely ignores invalid values and never serializes pageToken', () => {
    const parsed = parseAuditSearchParams({
      outcome: ['failure', 'not-an-outcome'],
      scopeType: ['platform', '', 'tenant'],
      scopeId: '   ',
      pageToken: 'opaque-secret',
    })
    const serialized = serializeAuditSearchParams(parsed)

    expect(parsed).toEqual({
      outcome: ['failure'],
      scopeType: ['platform'],
    })
    expect(serialized.get('pageToken')).toBeNull()
    expect(serialized.toString()).toBe('outcome=failure&scopeType=platform')
  })
})
