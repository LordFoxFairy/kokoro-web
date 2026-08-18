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
  },
  organizations: {
    q: '',
    status: 'all',
    sort: 'updatedAt',
    dir: 'desc',
    includeDeleted: false,
  },
  sites: {
    q: '',
    status: 'all',
    sort: 'updatedAt',
    dir: 'desc',
    includeDeleted: false,
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

function schemaFor<Resource extends DirectoryResource>(resource: Resource) {
  const common = {
    q: textParam,
    status: enumParam(entityStatuses, defaults[resource].status),
    sort: enumParam(sortFields[resource], defaults[resource].sort),
    dir: enumParam(sortDirections, defaults[resource].dir),
    includeDeleted: booleanParam,
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
  if (resource === 'sites' && parsed.organizationId) {
    params.set('organizationId', parsed.organizationId)
  }

  return params
}
