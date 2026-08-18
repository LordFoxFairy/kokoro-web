import { describe, expect, it } from 'vitest'
import {
  canAccessNavItem,
  projectNav,
  type NavCapabilityRules,
  type NavItemId,
} from './nav'

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

const capabilityFor = (itemId: NavItemId) => `admin.${itemId}.read`

const rules = Object.fromEntries(
  itemIds.map((itemId) => [itemId, { allOf: [capabilityFor(itemId)] }])
) as unknown as NavCapabilityRules

describe('projectNav', () => {
  it('returns no navigation groups when no capabilities are granted', () => {
    expect(projectNav([], rules)).toEqual([])
  })

  it('requires every capability in an allOf rule', () => {
    const allOfRules: NavCapabilityRules = {
      ...rules,
      users: { allOf: ['admin.users.read', 'admin.users.list'] },
    }

    expect(projectNav(['admin.users.read'], allOfRules)).toEqual([])
    expect(
      projectNav(
        ['admin.users.read', 'admin.users.list'],
        allOfRules
      )[0]?.items.map(({ id }) => id)
    ).toEqual(['users'])
  })

  it('accepts any one capability in an anyOf rule', () => {
    const anyOfRules: NavCapabilityRules = {
      ...rules,
      audit: { anyOf: ['admin.audit.read', 'admin.audit.export'] },
    }

    expect(
      projectNav(['admin.audit.export'], anyOfRules)[0]?.items[0]?.id
    ).toBe('audit')
    expect(projectNav(['admin.audit.manage'], anyOfRules)).toEqual([])
  })

  it('requires allOf and at least one anyOf capability when both are present', () => {
    const combinedRules: NavCapabilityRules = {
      ...rules,
      roles: {
        allOf: ['admin.roles.read'],
        anyOf: ['admin.roles.list', 'admin.roles.manage'],
      },
    }

    expect(projectNav(['admin.roles.read'], combinedRules)).toEqual([])
    expect(projectNav(['admin.roles.manage'], combinedRules)).toEqual([])
    expect(
      projectNav(['admin.roles.read', 'admin.roles.manage'], combinedRules)[0]
        ?.items[0]?.id
    ).toBe('roles')
  })

  it('omits an item when its required capability is missing', () => {
    const capabilities = itemIds
      .filter((itemId) => itemId !== 'sites')
      .map(capabilityFor)

    const projectedIds = projectNav(capabilities, rules).flatMap((group) =>
      group.items.map(({ id }) => id)
    )

    expect(projectedIds).not.toContain('sites')
    expect(projectedIds).toHaveLength(itemIds.length - 1)
  })

  it('removes groups whose items are all inaccessible', () => {
    const groups = projectNav(
      ['admin.dashboard.read', 'admin.audit.read'],
      rules
    )

    expect(groups.map(({ id }) => id)).toEqual(['workspace', 'security'])
    expect(groups.map(({ items }) => items.map(({ id }) => id))).toEqual([
      ['dashboard'],
      ['audit'],
    ])
  })

  it('projects every real navigation item with its production metadata', () => {
    const groups = projectNav(itemIds.map(capabilityFor), rules)

    expect(groups).toEqual([
      {
        id: 'workspace',
        label: '工作台',
        items: [
          {
            id: 'dashboard',
            label: 'Dashboard',
            href: '/',
            icon: 'layout-dashboard',
          },
        ],
      },
      {
        id: 'identity',
        label: '身份与租户',
        items: [
          { id: 'users', label: '用户', href: '/users', icon: 'users' },
          {
            id: 'organizations',
            label: '组织',
            href: '/organizations',
            icon: 'building-2',
          },
          {
            id: 'sites',
            label: 'Site',
            href: '/sites',
            icon: 'panels-top-left',
          },
        ],
      },
      {
        id: 'access',
        label: '访问控制',
        items: [
          {
            id: 'roles',
            label: '角色与权限',
            href: '/roles',
            icon: 'shield-check',
          },
          {
            id: 'access',
            label: '权限诊断',
            href: '/access',
            icon: 'scan-search',
          },
        ],
      },
      {
        id: 'security',
        label: '安全与审计',
        items: [
          {
            id: 'sessions',
            label: '会话',
            href: '/sessions',
            icon: 'monitor-smartphone',
          },
          {
            id: 'audit',
            label: '审计日志',
            href: '/audit',
            icon: 'scroll-text',
          },
        ],
      },
    ])
  })
})

describe('canAccessNavItem', () => {
  it('allows an item when its rule matches', () => {
    expect(canAccessNavItem('sessions', ['admin.sessions.read'], rules)).toBe(
      true
    )
  })

  it('denies an item when its rule does not match', () => {
    expect(canAccessNavItem('sessions', ['admin.audit.read'], rules)).toBe(
      false
    )
  })

  it('denies an item whose rule has no capability requirements', () => {
    expect(
      canAccessNavItem('dashboard', ['admin.dashboard.read'], {
        ...rules,
        dashboard: {},
      })
    ).toBe(false)
  })
})
