export type Capability = string

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

/** Capability codes stay opaque and come from the versioned IAM contract. */
export interface CapabilityRule {
  readonly allOf?: readonly Capability[]
  readonly anyOf?: readonly Capability[]
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

function matchesRule(
  granted: ReadonlySet<Capability>,
  rule: CapabilityRule
): boolean {
  const allOf = rule.allOf ?? []
  const anyOf = rule.anyOf ?? []

  if (allOf.length === 0 && anyOf.length === 0) return false

  return (
    allOf.every((capability) => granted.has(capability)) &&
    (anyOf.length === 0 || anyOf.some((capability) => granted.has(capability)))
  )
}

export function projectNav(
  capabilities: readonly Capability[],
  rules: NavCapabilityRules
): readonly NavGroup[] {
  const granted = new Set(capabilities)

  return NAV_GROUPS.flatMap((group) => {
    const items = group.items.filter((item) =>
      matchesRule(granted, rules[item.id])
    )

    return items.length === 0 ? [] : [{ ...group, items }]
  })
}

export function canAccessNavItem(
  itemId: NavItemId,
  capabilities: readonly Capability[],
  rules: NavCapabilityRules
): boolean {
  return matchesRule(new Set(capabilities), rules[itemId])
}
