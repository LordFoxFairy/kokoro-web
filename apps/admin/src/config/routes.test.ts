import { describe, expect, it } from 'vitest'
import { matchAdminRoute } from './routes'

describe('matchAdminRoute', () => {
  it('matches the Dashboard root', () => {
    expect(matchAdminRoute('/')).toEqual({
      pattern: '/',
      title: 'Dashboard',
      navItemId: 'dashboard',
      breadcrumbs: [{ title: 'Dashboard' }],
    })
  })

  it.each([
    ['/users', '用户', 'users'],
    ['/organizations', '组织', 'organizations'],
    ['/sites', 'Site', 'sites'],
    ['/roles', '角色与权限', 'roles'],
    ['/access', '权限诊断', 'access'],
    ['/sessions', '会话', 'sessions'],
    ['/audit', '审计日志', 'audit'],
  ] as const)(
    'matches the top-level route %s',
    (pathname, title, navItemId) => {
      expect(matchAdminRoute(pathname)).toEqual({
        pattern: pathname,
        title,
        navItemId,
        breadcrumbs: [{ title: 'Dashboard', href: '/' }, { title }],
      })
    }
  )

  it.each([
    ['/users/user-42', '/users/[id]', '用户详情', 'users', '用户', '/users'],
    [
      '/organizations/org-42',
      '/organizations/[id]',
      '组织详情',
      'organizations',
      '组织',
      '/organizations',
    ],
    ['/sites/site-42', '/sites/[id]', 'Site 详情', 'sites', 'Site', '/sites'],
  ] as const)(
    'matches the dynamic detail route %s without using its ID as a label',
    (pathname, pattern, title, navItemId, parentTitle, parentHref) => {
      expect(matchAdminRoute(pathname)).toEqual({
        pattern,
        title,
        navItemId,
        breadcrumbs: [
          { title: 'Dashboard', href: '/' },
          { title: parentTitle, href: parentHref },
          { title },
        ],
      })
    }
  )

  it('matches forbidden without assigning a navigation item', () => {
    expect(matchAdminRoute('/forbidden')).toMatchObject({
      title: '无权访问',
      navItemId: null,
    })
  })

  it.each([
    '/unknown',
    '/users/user-42/sessions',
    '/users?status=active',
    'users',
  ])('does not guess metadata for an unknown pathname: %s', (pathname) => {
    expect(matchAdminRoute(pathname)).toBeNull()
  })

  it('accepts a trailing slash on a known top-level route', () => {
    expect(matchAdminRoute('/users/')?.pattern).toBe('/users')
  })
})
