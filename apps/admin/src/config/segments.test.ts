import { describe, expect, it } from 'vitest'
import { ADMIN_ROUTES } from './routes'
import {
  ADMIN_SEGMENTS,
  assertSegmentContract,
  type AdminSegment,
} from './segments'

const EXPECTED_SEGMENTS = [
  ['login', 'auth', '/login', '(auth)/login/page.tsx', '登录', null, null],
  [
    'dashboard',
    'console',
    '/',
    '(console)/page.tsx',
    'Dashboard',
    '/',
    'features/dashboard/load.ts#loadDashboardPage',
  ],
  [
    'users',
    'console',
    '/users',
    '(console)/users/page.tsx',
    '用户',
    '/users',
    'features/directory/load.ts#loadDirectory',
  ],
  [
    'user-detail',
    'console',
    '/users/[id]',
    '(console)/users/[id]/page.tsx',
    '用户详情',
    '/users/[id]',
    'features/directory/detail-load.ts#loadDirectoryDetail',
  ],
  [
    'organizations',
    'console',
    '/organizations',
    '(console)/organizations/page.tsx',
    '组织',
    '/organizations',
    'features/directory/load.ts#loadDirectory',
  ],
  [
    'organization-detail',
    'console',
    '/organizations/[id]',
    '(console)/organizations/[id]/page.tsx',
    '组织详情',
    '/organizations/[id]',
    'features/directory/detail-load.ts#loadDirectoryDetail',
  ],
  [
    'sites',
    'console',
    '/sites',
    '(console)/sites/page.tsx',
    'Site',
    '/sites',
    'features/directory/load.ts#loadDirectory',
  ],
  [
    'site-detail',
    'console',
    '/sites/[id]',
    '(console)/sites/[id]/page.tsx',
    'Site 详情',
    '/sites/[id]',
    'features/directory/detail-load.ts#loadDirectoryDetail',
  ],
  [
    'roles',
    'console',
    '/roles',
    '(console)/roles/page.tsx',
    '角色与权限',
    '/roles',
    'features/roles/load.ts#loadRoles',
  ],
  [
    'access',
    'console',
    '/access',
    '(console)/access/page.tsx',
    '权限诊断',
    '/access',
    'features/access/load.ts#loadAccess',
  ],
  [
    'sessions',
    'console',
    '/sessions',
    '(console)/sessions/page.tsx',
    '会话',
    '/sessions',
    'features/security/load.ts#loadSessions',
  ],
  [
    'audit',
    'console',
    '/audit',
    '(console)/audit/page.tsx',
    '审计日志',
    '/audit',
    'features/security/load.ts#loadAudit',
  ],
  [
    'forbidden',
    'console',
    '/forbidden',
    '(console)/forbidden/page.tsx',
    '无权访问',
    '/forbidden',
    null,
  ],
  ['not-found', 'root', null, 'not-found.tsx', '页面不存在', null, null],
] as const

describe('ADMIN_SEGMENTS', () => {
  it('freezes the complete App Router target and loader ownership contract', () => {
    expect(
      ADMIN_SEGMENTS.map((segment) => [
        segment.id,
        segment.group,
        segment.pattern,
        segment.file,
        segment.metadata.title,
        segment.adminRoutePattern,
        segment.loaderOwner,
      ])
    ).toEqual(EXPECTED_SEGMENTS)
  })

  it('maps every registered Admin route exactly once without redefining it', () => {
    expect(
      ADMIN_SEGMENTS.flatMap((segment) =>
        segment.adminRoutePattern === null ? [] : [segment.adminRoutePattern]
      )
    ).toEqual(ADMIN_ROUTES.map((route) => route.pattern))

    expect(() =>
      assertSegmentContract(ADMIN_SEGMENTS, ADMIN_ROUTES)
    ).not.toThrow()
  })

  it('is deeply frozen at runtime', () => {
    expect(Object.isFrozen(ADMIN_SEGMENTS)).toBe(true)
    expect(ADMIN_SEGMENTS.every(Object.isFrozen)).toBe(true)
    expect(
      ADMIN_SEGMENTS.every((segment) => Object.isFrozen(segment.metadata))
    ).toBe(true)
  })

  it.each([
    ['duplicate ID', { ...ADMIN_SEGMENTS[1], id: 'login' }],
    ['duplicate file', { ...ADMIN_SEGMENTS[1], file: ADMIN_SEGMENTS[0].file }],
    [
      'unknown route group',
      { ...ADMIN_SEGMENTS[1], group: 'private' as 'console' },
    ],
    [
      'wrong route title',
      { ...ADMIN_SEGMENTS[1], metadata: { title: '概览' } },
    ],
    [
      'missing route mapping',
      { ...ADMIN_SEGMENTS[1], adminRoutePattern: null },
    ],
    [
      'protected route outside the console group',
      {
        ...ADMIN_SEGMENTS[1],
        group: 'auth' as const,
        file: '(auth)/dashboard/page.tsx',
      },
    ],
    [
      'auth page claiming an Admin route',
      {
        ...ADMIN_SEGMENTS[0],
        pattern: '/',
        adminRoutePattern: '/',
        metadata: { title: 'Dashboard' },
      },
    ],
    ['missing loader owner', { ...ADMIN_SEGMENTS[1], loaderOwner: null }],
    [
      'wrong loader owner',
      {
        ...ADMIN_SEGMENTS[1],
        loaderOwner: 'features/security/load.ts#loadAudit',
      },
    ],
    [
      'file path that disagrees with its URL pattern',
      { ...ADMIN_SEGMENTS[1], file: '(console)/overview/page.tsx' },
    ],
  ] as const)('rejects %s', (_label, replacement) => {
    const malformed: readonly AdminSegment[] = [
      ADMIN_SEGMENTS[0],
      replacement,
      ...ADMIN_SEGMENTS.slice(2),
    ]

    expect(() => assertSegmentContract(malformed, ADMIN_ROUTES)).toThrow(
      TypeError
    )
  })

  it('rejects duplicate routed patterns independently of files and IDs', () => {
    const duplicateLogin: AdminSegment = {
      id: 'second-login',
      group: 'auth',
      pattern: '/login',
      file: '(auth)/sign-in/page.tsx',
      metadata: { title: '另一个登录' },
      adminRoutePattern: null,
      loaderOwner: null,
    }

    expect(() =>
      assertSegmentContract([...ADMIN_SEGMENTS, duplicateLogin], ADMIN_ROUTES)
    ).toThrow(TypeError)
  })

  it('rejects additional root and renamed special entries', () => {
    const secondRoot: AdminSegment = {
      id: 'error-boundary',
      group: 'root',
      pattern: null,
      file: 'error.tsx',
      metadata: { title: '错误' },
      adminRoutePattern: null,
      loaderOwner: null,
    }
    const renamedLogin = [
      { ...ADMIN_SEGMENTS[0], id: 'sign-in' },
      ...ADMIN_SEGMENTS.slice(1),
    ]

    expect(() =>
      assertSegmentContract([...ADMIN_SEGMENTS, secondRoot], ADMIN_ROUTES)
    ).toThrow(TypeError)
    expect(() => assertSegmentContract(renamedLogin, ADMIN_ROUTES)).toThrow(
      TypeError
    )
  })

  it('keeps the public forbidden page as the only mapped null-loader exception', () => {
    const forbidden = ADMIN_SEGMENTS.find(({ id }) => id === 'forbidden')

    expect(forbidden).toMatchObject({
      group: 'console',
      adminRoutePattern: '/forbidden',
      loaderOwner: null,
    })
    expect(() =>
      assertSegmentContract(ADMIN_SEGMENTS, ADMIN_ROUTES)
    ).not.toThrow()
  })
})
