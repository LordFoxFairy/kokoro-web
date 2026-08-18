export const ADMIN_FIXTURE_SCHEMA_VERSION = 'kokoro.admin.fixture.v2' as const

export type AdminFixtureSchemaVersion = typeof ADMIN_FIXTURE_SCHEMA_VERSION

export type EntityId = string
export type Instant = string

export type Scope =
  | { readonly type: 'platform'; readonly id?: never }
  | { readonly type: 'organization'; readonly id: EntityId }
  | { readonly type: 'site'; readonly id: EntityId }

export type Capability = {
  readonly key: string
  readonly scope: Scope
}

export type CapabilityProjection = {
  readonly schemaVersion: AdminFixtureSchemaVersion
  readonly subjectId: EntityId
  readonly capabilities: readonly Capability[]
  readonly projectedAt: Instant
}

export type SortDirection = 'asc' | 'desc'

export type Sort = {
  readonly field: string
  readonly direction: SortDirection
}

export type PageRequest = {
  readonly pageSize?: number
  readonly pageToken?: string
  readonly query?: string
  readonly sort?: Sort
}

export type Page<T> = {
  readonly items: readonly T[]
  readonly nextPageToken?: string
  readonly totalCount?: number
}

export type RequestContext = {
  readonly signal?: AbortSignal
  readonly requestId?: string
}

export type DataResult<T> = {
  readonly data: T
  readonly requestId: string
  readonly schemaVersion: AdminFixtureSchemaVersion
}

export type FieldViolation = {
  readonly path: string
  readonly code: string
}

export type AdminErrorCode =
  | 'UNAUTHENTICATED'
  | 'PERMISSION_DENIED'
  | 'INVALID_ARGUMENT'
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'FAILED_PRECONDITION'
  | 'RESOURCE_EXHAUSTED'
  | 'UNAVAILABLE'
  | 'DEADLINE_EXCEEDED'
  | 'UNKNOWN'

export type AdminError = {
  readonly kind: 'admin-data-error'
  readonly code: AdminErrorCode
  readonly businessCode?: string
  readonly fieldViolations: readonly FieldViolation[]
  readonly requestId: string
  readonly retryAfterMs?: number
  readonly safeMessage?: string
}

export function isAdminError(value: unknown): value is AdminError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'admin-data-error'
  )
}
