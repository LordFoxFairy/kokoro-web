import type { NavItemId } from './nav'

export interface BreadcrumbItem {
  readonly title: string
  readonly href?: string
}

export interface AdminRoute {
  readonly pattern: string
  readonly title: string
  readonly navItemId: NavItemId | null
  readonly breadcrumbs: readonly BreadcrumbItem[]
}

const dashboardBreadcrumb: BreadcrumbItem = {
  title: 'Dashboard',
  href: '/',
}

function topLevelRoute(
  pattern: string,
  title: string,
  navItemId: NavItemId
): AdminRoute {
  return {
    pattern,
    title,
    navItemId,
    breadcrumbs: [dashboardBreadcrumb, { title }],
  }
}

function detailRoute(
  pattern: string,
  title: string,
  navItemId: NavItemId,
  parent: BreadcrumbItem
): AdminRoute {
  return {
    pattern,
    title,
    navItemId,
    breadcrumbs: [dashboardBreadcrumb, parent, { title }],
  }
}

export const ADMIN_ROUTES = [
  {
    pattern: '/',
    title: 'Dashboard',
    navItemId: 'dashboard',
    breadcrumbs: [{ title: 'Dashboard' }],
  },
  topLevelRoute('/users', '用户', 'users'),
  detailRoute('/users/[id]', '用户详情', 'users', {
    title: '用户',
    href: '/users',
  }),
  topLevelRoute('/organizations', '组织', 'organizations'),
  detailRoute('/organizations/[id]', '组织详情', 'organizations', {
    title: '组织',
    href: '/organizations',
  }),
  topLevelRoute('/sites', 'Site', 'sites'),
  detailRoute('/sites/[id]', 'Site 详情', 'sites', {
    title: 'Site',
    href: '/sites',
  }),
  topLevelRoute('/roles', '角色与权限', 'roles'),
  topLevelRoute('/access', '权限诊断', 'access'),
  topLevelRoute('/sessions', '会话', 'sessions'),
  topLevelRoute('/audit', '审计日志', 'audit'),
  {
    pattern: '/forbidden',
    title: '无权访问',
    navItemId: null,
    breadcrumbs: [dashboardBreadcrumb, { title: '无权访问' }],
  },
] as const satisfies readonly AdminRoute[]

function splitPath(path: string): readonly string[] {
  if (path === '/') return []
  return path.slice(1).split('/')
}

function matchesPattern(pattern: string, pathname: string): boolean {
  const patternSegments = splitPath(pattern)
  const pathnameSegments = splitPath(pathname)

  return (
    patternSegments.length === pathnameSegments.length &&
    patternSegments.every(
      (segment, index) =>
        (segment.startsWith('[') &&
          segment.endsWith(']') &&
          pathnameSegments[index] !== '') ||
        segment === pathnameSegments[index]
    )
  )
}

export function matchAdminRoute(pathname: string): AdminRoute | null {
  if (!pathname.startsWith('/')) return null

  const normalizedPathname =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname

  return (
    ADMIN_ROUTES.find(({ pattern }) =>
      matchesPattern(pattern, normalizedPathname)
    ) ?? null
  )
}
