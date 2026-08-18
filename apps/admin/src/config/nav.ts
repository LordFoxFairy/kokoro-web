import {
  matchesCapabilityRule,
  type Capability,
  type CapabilityRule,
} from '../lib/capabilities'

export type { Capability, CapabilityRule } from '../lib/capabilities'

export type NavItemId =
  | 'dashboard'
  | 'users'
  | 'organizations'
  | 'sites'
  | 'roles'
  | 'access'
  | 'sessions'
  | 'audit'

export type NavGroupId = 'workspace' | 'identity' | 'access' | 'security'

export type NavIcon =
  | 'layout-dashboard'
  | 'users'
  | 'building-2'
  | 'panels-top-left'
  | 'shield-check'
  | 'scan-search'
  | 'monitor-smartphone'
  | 'scroll-text'

export interface NavItem {
  readonly id: NavItemId
  readonly label: string
  readonly href: `/${string}` | '/'
  readonly icon: NavIcon
}

export interface NavGroup {
  readonly id: NavGroupId
  readonly label: string
  readonly items: readonly NavItem[]
}

export type NavCapabilityRules = Readonly<Record<NavItemId, CapabilityRule>>

const NAV_GROUPS = [
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
      { id: 'sites', label: 'Site', href: '/sites', icon: 'panels-top-left' },
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
      { id: 'access', label: '权限诊断', href: '/access', icon: 'scan-search' },
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
      { id: 'audit', label: '审计日志', href: '/audit', icon: 'scroll-text' },
    ],
  },
] as const satisfies readonly NavGroup[]

export function projectNav(
  capabilities: readonly Capability[],
  rules: NavCapabilityRules
): readonly NavGroup[] {
  return NAV_GROUPS.flatMap((group) => {
    const items = group.items.filter((item) =>
      matchesCapabilityRule(capabilities, rules[item.id])
    )

    return items.length === 0 ? [] : [{ ...group, items }]
  })
}

export function canAccessNavItem(
  itemId: NavItemId,
  capabilities: readonly Capability[],
  rules: NavCapabilityRules
): boolean {
  return matchesCapabilityRule(capabilities, rules[itemId])
}
