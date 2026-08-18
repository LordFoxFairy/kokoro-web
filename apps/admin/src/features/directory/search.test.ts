import { describe, expect, it } from 'vitest'
import { parseDirectorySearch, serializeDirectorySearch } from './search'

describe('directory search state', () => {
  it('uses resource defaults for absent and empty values', () => {
    expect(
      parseDirectorySearch('users', {
        q: '   ',
        status: '',
        sort: undefined,
        dir: '',
        includeDeleted: '',
      })
    ).toEqual({
      q: '',
      status: 'all',
      sort: 'updatedAt',
      dir: 'desc',
      includeDeleted: false,
      pageToken: '',
      pageSize: 20,
    })
  })

  it('reads the first value from repeated Next search params', () => {
    expect(
      parseDirectorySearch('sites', {
        q: ['  console  ', 'ignored'],
        status: ['active', 'deleted'],
        sort: ['name', 'createdAt'],
        dir: ['asc', 'desc'],
        includeDeleted: ['true', 'false'],
        pageToken: ['opaque+/==:token', 'ignored'],
        pageSize: ['50', '100'],
        organizationId: ['org_aurora', 'org_ignored'],
      })
    ).toEqual({
      q: 'console',
      status: 'active',
      sort: 'name',
      dir: 'asc',
      includeDeleted: true,
      pageToken: 'opaque+/==:token',
      pageSize: 50,
      organizationId: 'org_aurora',
    })
  })

  it('falls back safely for unsupported enum and boolean values', () => {
    expect(
      parseDirectorySearch('organizations', {
        status: 'pending',
        sort: 'memberCount',
        dir: 'sideways',
        includeDeleted: '1',
        organizationId: 'not-valid-for-this-resource',
        pageSize: '999',
      })
    ).toEqual({
      q: '',
      status: 'all',
      sort: 'updatedAt',
      dir: 'desc',
      includeDeleted: false,
      pageToken: '',
      pageSize: 20,
    })
  })

  it.each([
    String.raw`opaque\token`,
    'opaque\u0000token',
    'opaque\u001ftoken',
    'opaque\u007ftoken',
    'x'.repeat(513),
  ])('drops an unsafe page token: %j', (pageToken) => {
    expect(parseDirectorySearch('users', { pageToken }).pageToken).toBe('')
  })

  it('preserves an opaque page token without interpreting it', () => {
    const pageToken = 'v1.eyJvZmZzZXQiOjIwfQ==:opaque+/'
    const parsed = parseDirectorySearch('users', { pageToken })

    expect(parsed.pageToken).toBe(pageToken)
    expect(serializeDirectorySearch('users', parsed).get('pageToken')).toBe(
      pageToken
    )
  })

  it('roundtrips every supported resource state', () => {
    const cases = [
      [
        'users',
        {
          q: 'nakano',
          status: 'suspended',
          sort: 'email',
          dir: 'asc',
          includeDeleted: true,
          pageToken: 'user-page+/==',
          pageSize: 100,
        },
      ],
      [
        'organizations',
        {
          q: 'aurora',
          status: 'active',
          sort: 'slug',
          dir: 'asc',
          includeDeleted: false,
          pageToken: '',
          pageSize: 25,
        },
      ],
      [
        'sites',
        {
          q: 'console',
          status: 'deleted',
          sort: 'createdAt',
          dir: 'desc',
          includeDeleted: true,
          pageToken: 'site-page+/==',
          pageSize: 10,
          organizationId: 'org_aurora',
        },
      ],
    ] as const

    for (const [resource, state] of cases) {
      const serialized = serializeDirectorySearch(resource, state)
      expect(
        parseDirectorySearch(resource, Object.fromEntries(serialized))
      ).toEqual(state)
      expect(serializeDirectorySearch(resource, state).toString()).toBe(
        serialized.toString()
      )
    }
  })

  it('emits a stable short URL without default pagination values', () => {
    expect(
      serializeDirectorySearch('users', {
        q: '',
        status: 'all',
        sort: 'updatedAt',
        dir: 'desc',
        includeDeleted: false,
        pageToken: '',
        pageSize: 20,
      }).toString()
    ).toBe('')

    expect(
      serializeDirectorySearch('sites', {
        q: 'console',
        status: 'active',
        sort: 'name',
        dir: 'asc',
        includeDeleted: true,
        pageToken: 'next+/==',
        pageSize: 50,
        organizationId: 'org_aurora',
      }).toString()
    ).toBe(
      'q=console&status=active&sort=name&dir=asc&includeDeleted=true&pageToken=next%2B%2F%3D%3D&pageSize=50&organizationId=org_aurora'
    )
  })
})
