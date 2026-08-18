import { z } from 'zod'

export type DirectoryResource = 'users' | 'organizations' | 'sites'

export type SearchParamsInput = Readonly<
  Record<string, string | readonly string[] | undefined>
>

const entityStatuses = [
  'all',
  'active',
  'suspended',
  'deleted',
  'unknown',
] as const
const sortDirections = ['asc', 'desc'] as const
const pageSizes = ['10', '20', '25', '50', '100'] as const

const sortFields = {
  users: ['createdAt', 'displayName', 'email', 'status', 'updatedAt'],
  organizations: ['createdAt', 'name', 'slug', 'status', 'updatedAt'],
  sites: ['createdAt', 'name', 'slug', 'status', 'updatedAt'],
} as const satisfies Record<DirectoryResource, readonly string[]>

type SortFieldByResource = {
  [Resource in DirectoryResource]: (typeof sortFields)[Resource][number]
}

export type DirectorySearch<Resource extends DirectoryResource> = {
  readonly q: string
  readonly status: (typeof entityStatuses)[number]
  readonly sort: SortFieldByResource[Resource]
  readonly dir: (typeof sortDirections)[number]
  readonly includeDeleted: boolean
  readonly pageToken: string
  readonly pageSize: 10 | 20 | 25 | 50 | 100
} & (Resource extends 'sites'
  ? { readonly organizationId: string }
  : { readonly organizationId?: never })

const defaults = {
  users: {
    q: '',
    status: 'all',
    sort: 'updatedAt',
    dir: 'desc',
    includeDeleted: false,
    pageToken: '',
    pageSize: 20,
  },
  organizations: {
    q: '',
    status: 'all',
    sort: 'updatedAt',
    dir: 'desc',
    includeDeleted: false,
    pageToken: '',
    pageSize: 20,
  },
  sites: {
    q: '',
    status: 'all',
    sort: 'updatedAt',
    dir: 'desc',
    includeDeleted: false,
    pageToken: '',
    pageSize: 20,
    organizationId: '',
  },
} as const satisfies {
  [Resource in DirectoryResource]: DirectorySearch<Resource>
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value
}

const textParam = z.preprocess(firstValue, z.string().trim().catch(''))

const enumParam = <Values extends readonly [string, ...string[]]>(
  values: Values,
  fallback: Values[number]
) => z.preprocess(firstValue, z.enum(values).catch(fallback))

const booleanParam = z.preprocess(
  firstValue,
  z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .catch(false)
)

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f || code === 0x7f) return true
  }
  return false
}

const pageTokenParam = z.preprocess(
  firstValue,
  z
    .string()
    .max(512)
    .refine(
      (value) => !hasControlCharacter(value) && !value.includes('\\'),
      'Unsafe page token'
    )
    .catch('')
)

const pageSizeParam = z.preprocess(
  firstValue,
  z
    .enum(pageSizes)
    .transform((value) => Number(value) as 10 | 20 | 25 | 50 | 100)
    .catch(20)
)

function schemaFor<Resource extends DirectoryResource>(resource: Resource) {
  const common = {
    q: textParam,
    status: enumParam(entityStatuses, defaults[resource].status),
    sort: enumParam(sortFields[resource], defaults[resource].sort),
    dir: enumParam(sortDirections, defaults[resource].dir),
    includeDeleted: booleanParam,
    pageToken: pageTokenParam,
    pageSize: pageSizeParam,
  }

  return resource === 'sites'
    ? z.object({ ...common, organizationId: textParam })
    : z.object(common)
}

export function parseDirectorySearch<Resource extends DirectoryResource>(
  resource: Resource,
  searchParams: SearchParamsInput
): DirectorySearch<Resource> {
  return schemaFor(resource).parse(searchParams) as DirectorySearch<Resource>
}

export function serializeDirectorySearch<Resource extends DirectoryResource>(
  resource: Resource,
  search: DirectorySearch<Resource>
): URLSearchParams {
  const parsed = parseDirectorySearch(resource, {
    q: search.q,
    status: search.status,
    sort: search.sort,
    dir: search.dir,
    includeDeleted: String(search.includeDeleted),
    pageToken: search.pageToken,
    pageSize: String(search.pageSize),
    organizationId:
      'organizationId' in search ? search.organizationId : undefined,
  })
  const baseline = defaults[resource]
  const params = new URLSearchParams()

  if (parsed.q) params.set('q', parsed.q)
  if (parsed.status !== baseline.status) params.set('status', parsed.status)
  if (parsed.sort !== baseline.sort) params.set('sort', parsed.sort)
  if (parsed.dir !== baseline.dir) params.set('dir', parsed.dir)
  if (parsed.includeDeleted) params.set('includeDeleted', 'true')
  if (parsed.pageToken) params.set('pageToken', parsed.pageToken)
  if (parsed.pageSize !== baseline.pageSize) {
    params.set('pageSize', String(parsed.pageSize))
  }
  if (resource === 'sites' && parsed.organizationId) {
    params.set('organizationId', parsed.organizationId)
  }

  return params
}
