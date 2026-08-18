export const DETAIL_TABS = {
  users: ['overview', 'memberships', 'roles', 'sessions', 'audit'],
  organizations: ['overview', 'members', 'roles', 'audit'],
  sites: ['overview', 'members', 'roles', 'access', 'audit'],
} as const

export type DetailResource = keyof typeof DETAIL_TABS
export type DetailTab<Resource extends DetailResource> =
  (typeof DETAIL_TABS)[Resource][number]

export const DEFAULT_DETAIL_TABS = {
  users: 'overview',
  organizations: 'overview',
  sites: 'overview',
} as const satisfies {
  readonly [Resource in DetailResource]: DetailTab<Resource>
}

export type DetailState<Resource extends DetailResource> = Readonly<{
  tab: DetailTab<Resource>
  returnTo: string | null
}>

export type DetailSearchValue = string | readonly string[] | undefined
export type DetailSearchSource =
  Readonly<Record<string, DetailSearchValue>> | URLSearchParams

const LIST_PATHS = {
  users: '/users',
  organizations: '/organizations',
  sites: '/sites',
} as const satisfies Readonly<Record<DetailResource, string>>

const SORT_FIELDS = {
  users: new Set(['createdAt', 'displayName', 'email', 'status', 'updatedAt']),
  organizations: new Set(['createdAt', 'name', 'slug', 'status', 'updatedAt']),
  sites: new Set(['createdAt', 'name', 'slug', 'status', 'updatedAt']),
} as const satisfies Readonly<Record<DetailResource, ReadonlySet<string>>>

const ENTITY_STATUSES = new Set([
  'all',
  'active',
  'suspended',
  'deleted',
  'unknown',
])
const SORT_DIRECTIONS = new Set(['asc', 'desc'])
const COMMON_RETURN_KEYS = new Set([
  'q',
  'status',
  'sort',
  'dir',
  'includeDeleted',
  'pageToken',
  'pageSize',
])

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

function readSingle(source: DetailSearchSource, key: string): string | null {
  if (source instanceof URLSearchParams) {
    const values = source.getAll(key)
    return values.length === 1 ? values[0] : null
  }

  const value = source[key]
  return typeof value === 'string' ? value : null
}

function isAllowedTab<Resource extends DetailResource>(
  resource: Resource,
  value: string
): value is DetailTab<Resource> {
  return (DETAIL_TABS[resource] as readonly string[]).includes(value)
}

function appendCanonicalQuery(
  resource: DetailResource,
  input: URLSearchParams,
  output: URLSearchParams
): boolean {
  const allowedKeys =
    resource === 'sites'
      ? new Set([...COMMON_RETURN_KEYS, 'organizationId'])
      : COMMON_RETURN_KEYS

  for (const key of new Set(input.keys())) {
    const values = input.getAll(key)
    if (!allowedKeys.has(key) || values.length !== 1) return false
    if (hasControlCharacter(values[0]) || values[0].includes('\\')) return false
  }

  const q = input.get('q')?.trim()
  if (q) output.set('q', q)

  const status = input.get('status')
  if (status !== null && !ENTITY_STATUSES.has(status)) return false
  if (status && status !== 'all') output.set('status', status)

  const sort = input.get('sort')
  if (sort !== null && !SORT_FIELDS[resource].has(sort)) return false
  if (sort && sort !== 'updatedAt') output.set('sort', sort)

  const direction = input.get('dir')
  if (direction !== null && !SORT_DIRECTIONS.has(direction)) return false
  if (direction && direction !== 'desc') output.set('dir', direction)

  const includeDeleted = input.get('includeDeleted')
  if (
    includeDeleted !== null &&
    includeDeleted !== 'true' &&
    includeDeleted !== 'false'
  ) {
    return false
  }
  if (includeDeleted === 'true') output.set('includeDeleted', 'true')

  const pageToken = input.get('pageToken')
  if (pageToken !== null && pageToken.length > 512) return false
  if (pageToken) output.set('pageToken', pageToken)

  const pageSize = input.get('pageSize')
  if (
    pageSize !== null &&
    !new Set(['10', '20', '25', '50', '100']).has(pageSize)
  ) {
    return false
  }
  if (pageSize && pageSize !== '20') output.set('pageSize', pageSize)

  if (resource === 'sites') {
    const organizationId = input.get('organizationId')?.trim()
    if (organizationId) output.set('organizationId', organizationId)
  }

  return true
}

function safeReturnTo(
  resource: DetailResource,
  value: string | null
): string | null {
  if (
    value === null ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('#')
  ) {
    return null
  }

  try {
    const url = new URL(value, 'https://admin.invalid')
    if (
      url.origin !== 'https://admin.invalid' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== LIST_PATHS[resource] ||
      url.hash !== ''
    ) {
      return null
    }

    const query = new URLSearchParams()
    if (!appendCanonicalQuery(resource, url.searchParams, query)) return null
    const serialized = query.toString()
    return serialized
      ? `${LIST_PATHS[resource]}?${serialized}`
      : LIST_PATHS[resource]
  } catch {
    return null
  }
}

export function parseDetailState<Resource extends DetailResource>(
  resource: Resource,
  source: DetailSearchSource
): DetailState<Resource> {
  const tabValue = readSingle(source, 'tab')
  const returnToValue = readSingle(source, 'returnTo')

  return {
    tab:
      tabValue !== null && isAllowedTab(resource, tabValue)
        ? tabValue
        : DEFAULT_DETAIL_TABS[resource],
    returnTo: safeReturnTo(resource, returnToValue),
  }
}

export function serializeDetailState<Resource extends DetailResource>(
  resource: Resource,
  state: DetailState<Resource>
): URLSearchParams {
  const output = new URLSearchParams()
  if (
    isAllowedTab(resource, state.tab) &&
    state.tab !== DEFAULT_DETAIL_TABS[resource]
  ) {
    output.set('tab', state.tab)
  }

  const returnTo = safeReturnTo(resource, state.returnTo)
  if (returnTo !== null) output.set('returnTo', returnTo)
  return output
}
