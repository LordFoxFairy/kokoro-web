import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DETAIL_TABS,
  DETAIL_TABS,
  parseDetailState,
  serializeDetailState,
} from './detail-state'

describe('detail tabs', () => {
  it('declares the page-matrix tabs for every detail resource', () => {
    expect(DETAIL_TABS).toEqual({
      users: ['overview', 'memberships', 'roles', 'sessions', 'audit'],
      organizations: ['overview', 'members', 'roles', 'audit'],
      sites: ['overview', 'members', 'roles', 'access', 'audit'],
    })
    expect(DEFAULT_DETAIL_TABS).toEqual({
      users: 'overview',
      organizations: 'overview',
      sites: 'overview',
    })
  })

  it.each([
    ['users', 'sessions'],
    ['organizations', 'members'],
    ['sites', 'access'],
  ] as const)('parses an allowed %s tab', (resource, tab) => {
    expect(parseDetailState(resource, { tab })).toEqual({
      tab,
      returnTo: null,
    })
  })

  it.each([
    ['users', undefined],
    ['users', 'members'],
    ['organizations', 'sessions'],
    ['sites', 'permissions'],
    ['sites', ['audit', 'access']],
  ] as const)('uses the default for an unknown %s tab', (resource, tab) => {
    expect(parseDetailState(resource, { tab }).tab).toBe('overview')
  })
})

describe('detail return path', () => {
  it.each([
    ['users', '/users', '/users'],
    [
      'users',
      '/users?q=Ada%20Lovelace&status=active&sort=email&dir=asc&includeDeleted=true&pageToken=next%2B%2F%3D%3D&pageSize=50',
      '/users?q=Ada+Lovelace&status=active&sort=email&dir=asc&includeDeleted=true&pageToken=next%2B%2F%3D%3D&pageSize=50',
    ],
    [
      'organizations',
      '/organizations?q=Core&status=deleted&sort=slug&dir=desc',
      '/organizations?q=Core&status=deleted&sort=slug',
    ],
    [
      'sites',
      '/sites?organizationId=org_42&status=suspended&sort=name',
      '/sites?status=suspended&sort=name&organizationId=org_42',
    ],
  ] as const)(
    'accepts and canonicalizes a safe %s list path',
    (resource, returnTo, expected) => {
      expect(parseDetailState(resource, { returnTo })).toEqual({
        tab: 'overview',
        returnTo: expected,
      })
    }
  )

  it.each([
    ['users', '/organizations'],
    ['organizations', '/sites'],
    ['sites', '/users'],
    ['users', '/users/'],
    ['users', '/users/42'],
    ['users', 'users'],
    ['users', '//evil.test/users'],
    ['users', '///evil.test/users'],
    ['users', 'https://admin.example.test/users'],
    ['users', 'https://user:secret@admin.example.test/users'],
    ['users', String.raw`/users\evil`],
    ['users', '/users#selection'],
    ['users', '/users?cursor=opaque-token'],
    ['users', '/users?token=opaque-token'],
    ['users', '/users?unknown=value'],
    ['users', '/users?q=one&q=two'],
    ['users', '/users?status=pending'],
    ['users', '/users?sort=slug'],
    ['users', '/users?dir=sideways'],
    ['users', '/users?organizationId=org_42'],
    ['sites', '/sites?sort=email'],
    ['sites', '/sites?q=%00unsafe'],
    ['sites', '/sites?q=%5Cunsafe'],
    ['sites', '/sites?organizationId=%0Aorg_42'],
    ['users', '/users?page=1'],
    ['users', String.raw`/users?pageToken=opaque\token`],
    ['users', '/users?pageToken=opaque%00token'],
    ['users', `/users?pageToken=${'x'.repeat(513)}`],
    ['users', '/users?pageSize=999'],
    ['users', '/users%5Cevil'],
  ] as const)(
    'drops an unsafe or unsupported %s return path: %s',
    (resource, returnTo) => {
      expect(parseDetailState(resource, { returnTo }).returnTo).toBeNull()
    }
  )

  it('normalizes supported default query values out of the return path', () => {
    expect(
      parseDetailState('users', {
        returnTo:
          '/users?q=%20&status=all&sort=updatedAt&dir=desc&includeDeleted=false&pageSize=20',
      }).returnTo
    ).toBe('/users')
  })

  it('does not read a second value or unrelated opaque state', () => {
    expect(
      parseDetailState('users', {
        tab: ['audit', 'sessions'],
        returnTo: ['/users', '/users?cursor=opaque'],
        state: 'opaque-token',
      })
    ).toEqual({ tab: 'overview', returnTo: null })
  })

  it('preserves an opaque page token in a return path', () => {
    const pageToken = 'v1.eyJvZmZzZXQiOjIwfQ==:opaque+/'
    const returnTo = `/users?pageToken=${encodeURIComponent(pageToken)}`

    expect(parseDetailState('users', { returnTo }).returnTo).toBe(returnTo)
  })
})

describe('detail state serialization', () => {
  it.each([
    ['users', 'audit', '/users?status=active'],
    ['organizations', 'roles', '/organizations?includeDeleted=true'],
    ['sites', 'members', '/sites?organizationId=org_42'],
  ] as const)('round-trips a valid %s state', (resource, tab, returnTo) => {
    const state = parseDetailState(resource, { tab, returnTo })

    expect(
      parseDetailState(resource, serializeDetailState(resource, state))
    ).toEqual(state)
  })

  it('omits defaults and rejects invalid values at the serialization boundary', () => {
    expect(
      serializeDetailState('users', {
        tab: 'overview',
        returnTo: null,
      }).toString()
    ).toBe('')

    expect(
      serializeDetailState('users', {
        tab: 'audit',
        returnTo: '/users?cursor=opaque-token',
      }).toString()
    ).toBe('tab=audit')
  })
})
