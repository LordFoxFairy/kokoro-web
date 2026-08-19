import { ADMIN_ROUTES, type AdminRoute } from './routes'

export type SegmentGroup = 'auth' | 'console' | 'root'

export interface AdminSegment {
  readonly id: string
  readonly group: SegmentGroup
  readonly pattern: string | null
  readonly file: string
  readonly metadata: Readonly<{ readonly title: string }>
  readonly adminRoutePattern: string | null
  readonly loaderOwner: string | null
}

const ROUTE_LOADER_OWNERS = Object.freeze({
  '/': 'features/dashboard/load.ts#loadDashboardPage',
  '/users': 'features/directory/load.ts#loadDirectory',
  '/users/[id]': 'features/directory/detail-load.ts#loadDirectoryDetail',
  '/organizations': 'features/directory/load.ts#loadDirectory',
  '/organizations/[id]':
    'features/directory/detail-load.ts#loadDirectoryDetail',
  '/sites': 'features/directory/load.ts#loadDirectory',
  '/sites/[id]': 'features/directory/detail-load.ts#loadDirectoryDetail',
  '/roles': 'features/roles/load.ts#loadRoles',
  '/access': 'features/access/load.ts#loadAccess',
  '/sessions': 'features/security/load.ts#loadSessions',
  '/audit': 'features/security/load.ts#loadAudit',
  '/forbidden': null,
} as const)

type RegisteredRoutePattern = keyof typeof ROUTE_LOADER_OWNERS

function segment(value: AdminSegment): AdminSegment {
  return Object.freeze({
    ...value,
    metadata: Object.freeze({ ...value.metadata }),
  })
}

export const ADMIN_SEGMENTS = Object.freeze([
  segment({
    id: 'login',
    group: 'auth',
    pattern: '/login',
    file: '(auth)/login/page.tsx',
    metadata: { title: '登录' },
    adminRoutePattern: null,
    loaderOwner: null,
  }),
  segment({
    id: 'dashboard',
    group: 'console',
    pattern: '/',
    file: '(console)/page.tsx',
    metadata: { title: 'Dashboard' },
    adminRoutePattern: '/',
    loaderOwner: 'features/dashboard/load.ts#loadDashboardPage',
  }),
  segment({
    id: 'users',
    group: 'console',
    pattern: '/users',
    file: '(console)/users/page.tsx',
    metadata: { title: '用户' },
    adminRoutePattern: '/users',
    loaderOwner: 'features/directory/load.ts#loadDirectory',
  }),
  segment({
    id: 'user-detail',
    group: 'console',
    pattern: '/users/[id]',
    file: '(console)/users/[id]/page.tsx',
    metadata: { title: '用户详情' },
    adminRoutePattern: '/users/[id]',
    loaderOwner: 'features/directory/detail-load.ts#loadDirectoryDetail',
  }),
  segment({
    id: 'organizations',
    group: 'console',
    pattern: '/organizations',
    file: '(console)/organizations/page.tsx',
    metadata: { title: '组织' },
    adminRoutePattern: '/organizations',
    loaderOwner: 'features/directory/load.ts#loadDirectory',
  }),
  segment({
    id: 'organization-detail',
    group: 'console',
    pattern: '/organizations/[id]',
    file: '(console)/organizations/[id]/page.tsx',
    metadata: { title: '组织详情' },
    adminRoutePattern: '/organizations/[id]',
    loaderOwner: 'features/directory/detail-load.ts#loadDirectoryDetail',
  }),
  segment({
    id: 'sites',
    group: 'console',
    pattern: '/sites',
    file: '(console)/sites/page.tsx',
    metadata: { title: 'Site' },
    adminRoutePattern: '/sites',
    loaderOwner: 'features/directory/load.ts#loadDirectory',
  }),
  segment({
    id: 'site-detail',
    group: 'console',
    pattern: '/sites/[id]',
    file: '(console)/sites/[id]/page.tsx',
    metadata: { title: 'Site 详情' },
    adminRoutePattern: '/sites/[id]',
    loaderOwner: 'features/directory/detail-load.ts#loadDirectoryDetail',
  }),
  segment({
    id: 'roles',
    group: 'console',
    pattern: '/roles',
    file: '(console)/roles/page.tsx',
    metadata: { title: '角色与权限' },
    adminRoutePattern: '/roles',
    loaderOwner: 'features/roles/load.ts#loadRoles',
  }),
  segment({
    id: 'access',
    group: 'console',
    pattern: '/access',
    file: '(console)/access/page.tsx',
    metadata: { title: '权限诊断' },
    adminRoutePattern: '/access',
    loaderOwner: 'features/access/load.ts#loadAccess',
  }),
  segment({
    id: 'sessions',
    group: 'console',
    pattern: '/sessions',
    file: '(console)/sessions/page.tsx',
    metadata: { title: '会话' },
    adminRoutePattern: '/sessions',
    loaderOwner: 'features/security/load.ts#loadSessions',
  }),
  segment({
    id: 'audit',
    group: 'console',
    pattern: '/audit',
    file: '(console)/audit/page.tsx',
    metadata: { title: '审计日志' },
    adminRoutePattern: '/audit',
    loaderOwner: 'features/security/load.ts#loadAudit',
  }),
  segment({
    id: 'forbidden',
    group: 'console',
    pattern: '/forbidden',
    file: '(console)/forbidden/page.tsx',
    metadata: { title: '无权访问' },
    adminRoutePattern: '/forbidden',
    loaderOwner: null,
  }),
  segment({
    id: 'not-found',
    group: 'root',
    pattern: null,
    file: 'not-found.tsx',
    metadata: { title: '页面不存在' },
    adminRoutePattern: null,
    loaderOwner: null,
  }),
] as const satisfies readonly AdminSegment[])

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`Admin segment ${field} values must be unique`)
  }
}

function expectedPrefix(group: SegmentGroup): string {
  if (group === 'auth') return '(auth)/'
  if (group === 'console') return '(console)/'
  return ''
}

function expectedPageFile(
  group: Exclude<SegmentGroup, 'root'>,
  pattern: string
): string {
  const routePath = pattern === '/' ? '' : `${pattern.slice(1)}/`
  return `(${group})/${routePath}page.tsx`
}

function assertSpecialSegments(segments: readonly AdminSegment[]): void {
  const login = segments.filter(({ id }) => id === 'login')
  const forbidden = segments.filter(({ id }) => id === 'forbidden')
  const notFound = segments.filter(({ id }) => id === 'not-found')

  if (
    login.length !== 1 ||
    login[0]?.group !== 'auth' ||
    login[0].pattern !== '/login' ||
    login[0].file !== '(auth)/login/page.tsx' ||
    login[0].adminRoutePattern !== null ||
    login[0].loaderOwner !== null
  ) {
    throw new TypeError('Admin segments must contain exactly one login page')
  }
  if (
    forbidden.length !== 1 ||
    forbidden[0]?.group !== 'console' ||
    forbidden[0].pattern !== '/forbidden' ||
    forbidden[0].file !== '(console)/forbidden/page.tsx' ||
    forbidden[0].adminRoutePattern !== '/forbidden' ||
    forbidden[0].loaderOwner !== null
  ) {
    throw new TypeError(
      'Admin segments must contain exactly one loader-free forbidden page'
    )
  }
  if (
    notFound.length !== 1 ||
    notFound[0]?.group !== 'root' ||
    notFound[0].pattern !== null ||
    notFound[0].file !== 'not-found.tsx' ||
    notFound[0].adminRoutePattern !== null ||
    notFound[0].loaderOwner !== null ||
    segments.filter(({ group }) => group === 'root').length !== 1
  ) {
    throw new TypeError(
      'Admin segments must contain exactly one root not-found page'
    )
  }
}

function isSegmentGroup(value: unknown): value is SegmentGroup {
  return value === 'auth' || value === 'console' || value === 'root'
}

function isRegisteredRoutePattern(
  value: string
): value is RegisteredRoutePattern {
  return Object.hasOwn(ROUTE_LOADER_OWNERS, value)
}

export function assertSegmentContract(
  segments: readonly AdminSegment[],
  routes: readonly AdminRoute[]
): void {
  assertUnique(
    segments.map(({ id }) => id),
    'id'
  )
  assertUnique(
    segments.map(({ file }) => file),
    'file'
  )
  assertUnique(
    segments.flatMap(({ pattern }) => (pattern === null ? [] : [pattern])),
    'pattern'
  )
  assertSpecialSegments(segments)

  for (const value of segments) {
    if (
      typeof value.id !== 'string' ||
      value.id.length === 0 ||
      typeof value.file !== 'string' ||
      value.file.length === 0 ||
      !isSegmentGroup(value.group) ||
      typeof value.metadata?.title !== 'string' ||
      value.metadata.title.length === 0 ||
      !value.file.startsWith(expectedPrefix(value.group))
    ) {
      throw new TypeError(`Invalid Admin segment: ${value.id || '<unknown>'}`)
    }
    if (value.group === 'root' && value.pattern !== null) {
      throw new TypeError('Root-only files must not claim a URL pattern')
    }
    if (value.group !== 'root' && value.pattern === null) {
      throw new TypeError('Routed pages must declare a URL pattern')
    }
    if (
      value.group !== 'root' &&
      value.pattern !== null &&
      value.file !== expectedPageFile(value.group, value.pattern)
    ) {
      throw new TypeError(`Admin segment file drifted: ${value.id}`)
    }
    if (
      value.group !== 'console' &&
      (value.adminRoutePattern !== null || value.loaderOwner !== null)
    ) {
      throw new TypeError(
        'Auth and root pages cannot own Admin routes or loaders'
      )
    }
    if (value.group === 'console' && value.adminRoutePattern === null) {
      throw new TypeError('Console pages must map an Admin route')
    }
  }

  const mapped = segments.filter(
    (value): value is AdminSegment & { adminRoutePattern: string } =>
      value.adminRoutePattern !== null
  )
  assertUnique(
    mapped.map(({ adminRoutePattern }) => adminRoutePattern),
    'adminRoutePattern'
  )

  if (mapped.length !== routes.length) {
    throw new TypeError('Admin segment registry must map every Admin route')
  }

  for (const route of routes) {
    const routePattern = route.pattern
    if (!isRegisteredRoutePattern(routePattern)) {
      throw new TypeError(`Admin route has no loader contract: ${routePattern}`)
    }
    const expectedLoaderOwner = ROUTE_LOADER_OWNERS[routePattern]
    const value = mapped.find(
      ({ adminRoutePattern }) => adminRoutePattern === routePattern
    )
    if (
      !value ||
      value.group !== 'console' ||
      value.pattern !== routePattern ||
      value.metadata.title !== route.title ||
      value.loaderOwner !== expectedLoaderOwner
    ) {
      throw new TypeError(`Admin route mapping drifted: ${routePattern}`)
    }
  }
}

assertSegmentContract(ADMIN_SEGMENTS, ADMIN_ROUTES)
