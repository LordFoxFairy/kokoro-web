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
        organizationId: ['org_aurora', 'org_ignored'],
      })
    ).toEqual({
      q: 'console',
      status: 'active',
      sort: 'name',
      dir: 'asc',
      includeDeleted: true,
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
        pageToken: 'opaque-token-is-not-search-state',
      })
    ).toEqual({
      q: '',
      status: 'all',
      sort: 'updatedAt',
      dir: 'desc',
      includeDeleted: false,
    })
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

  it('emits a stable short URL without defaults or opaque page tokens', () => {
    expect(
      serializeDirectorySearch('users', {
        q: '',
        status: 'all',
        sort: 'updatedAt',
        dir: 'desc',
        includeDeleted: false,
      }).toString()
    ).toBe('')

    expect(
      serializeDirectorySearch('sites', {
        q: 'console',
        status: 'active',
        sort: 'name',
        dir: 'asc',
        includeDeleted: true,
        organizationId: 'org_aurora',
      }).toString()
    ).toBe(
      'q=console&status=active&sort=name&dir=asc&includeDeleted=true&organizationId=org_aurora'
    )
  })
})
