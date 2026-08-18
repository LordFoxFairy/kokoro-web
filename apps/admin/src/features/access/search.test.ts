import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ACCESS_SEARCH,
  DEFAULT_ROLES_SEARCH,
  parseAccessSearch,
  parseRolesSearch,
  serializeAccessSearch,
  serializeRolesSearch,
} from './search'

describe('roles search state', () => {
  it('uses safe defaults for empty and unknown values', () => {
    expect(
      parseRolesSearch({ scopeType: 'workspace', includeDeleted: 'yes' })
    ).toEqual(DEFAULT_ROLES_SEARCH)
  })

  it('drops incomplete scope combinations without discarding valid filters', () => {
    expect(
      parseRolesSearch({
        scopeType: 'site',
        q: '  support  ',
        roleId: 'role-1',
      })
    ).toEqual({
      roleId: 'role-1',
      includeDeleted: false,
      q: 'support',
    })
  })

  it('accepts Next.js array parameters deterministically', () => {
    expect(
      parseRolesSearch({
        scopeType: ['organization', 'site'],
        scopeId: ['org-1', 'site-1'],
        includeDeleted: ['true', 'false'],
      })
    ).toEqual({
      scopeType: 'organization',
      scopeId: 'org-1',
      includeDeleted: true,
    })
  })

  it('roundtrips canonical state', () => {
    const state = {
      scopeType: 'site' as const,
      scopeId: 'site-1',
      roleId: 'role-1',
      includeDeleted: true,
      q: 'operator',
    }

    expect(parseRolesSearch(serializeRolesSearch(state))).toEqual(state)
  })

  it('omits defaults and incomplete scope during serialization', () => {
    expect(
      serializeRolesSearch({
        scopeType: 'site',
        includeDeleted: false,
      })
    ).toHaveProperty('size', 0)
  })
})

describe('access search state', () => {
  it('uses safe defaults for unknown and incomplete scope values', () => {
    expect(
      parseAccessSearch({ scopeType: 'tenant', scopeId: 'tenant-1' })
    ).toEqual(DEFAULT_ACCESS_SEARCH)
    expect(parseAccessSearch({ scopeId: 'site-1' })).toEqual(
      DEFAULT_ACCESS_SEARCH
    )
  })

  it('parses each diagnostic selector without deriving authorization', () => {
    expect(
      parseAccessSearch({
        subjectId: ' user-1 ',
        scopeType: 'organization',
        scopeId: ' org-1 ',
        resource: ' members ',
        action: ' read ',
      })
    ).toEqual({
      subjectId: 'user-1',
      scopeType: 'organization',
      scopeId: 'org-1',
      resource: 'members',
      action: 'read',
    })
  })

  it('roundtrips canonical state', () => {
    const state = {
      subjectId: 'user-1',
      scopeType: 'site' as const,
      scopeId: 'site-1',
      resource: 'sessions',
      action: 'revoke',
    }

    expect(parseAccessSearch(serializeAccessSearch(state))).toEqual(state)
  })

  it('serializes stable URL values and omits incomplete scope', () => {
    expect(
      serializeAccessSearch({
        subjectId: 'user-1',
        scopeType: 'organization',
        resource: 'audit',
        action: 'read',
      })
    ).toHaveProperty(
      'size',
      new URLSearchParams('subjectId=user-1&resource=audit&action=read').size
    )
    expect(
      serializeAccessSearch({
        subjectId: 'user-1',
        scopeType: 'organization',
        resource: 'audit',
        action: 'read',
      }).toString()
    ).toBe('subjectId=user-1&resource=audit&action=read')
  })
})
