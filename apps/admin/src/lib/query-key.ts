import type { Scope } from './view-models'

export type QueryScope = Scope

export type QueryParameter =
  | string
  | number
  | boolean
  | null
  | readonly QueryParameter[]
  | Readonly<{ [field: string]: QueryParameter }>

export type QueryKeyInput = Readonly<{
  identityId: string
  scope: QueryScope
  contractVersion: string
  domain: string
  operation: string
  params: Readonly<{ [field: string]: QueryParameter }>
}>

export type AdminQueryKey = readonly [
  schema: 'kokoro.admin.query.v1',
  contractVersion: string,
  identityId: string,
  scopeType: string,
  scopeId: string,
  domain: string,
  operation: string,
  canonicalParams: string,
]

const inputFields = new Set([
  'identityId',
  'scope',
  'contractVersion',
  'domain',
  'operation',
  'params',
])
const scopeFields = new Set(['type', 'id'])
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const operationPattern = /^[a-z][a-z0-9._-]{0,127}$/
const sensitiveFieldFragments = [
  'token',
  'password',
  'passwd',
  'cookie',
  'authorization',
  'secret',
  'credential',
  'apikey',
] as const

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch {
    return false
  }
}

function ownDataValue(value: object, field: string, path: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    if (descriptor === undefined) return undefined
    if (!('value' in descriptor)) {
      throw new Error(`${path} must be an own data property`)
    }
    return descriptor.value
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(path)) throw error
    throw new Error(`${path} must be an own data property`, { cause: error })
  }
}

function ownEnumerableFields(value: object, path: string): readonly string[] {
  try {
    return Object.keys(value)
  } catch {
    throw new Error(`${path} must expose stable own fields`)
  }
}

function assertExactFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
  path: string
): void {
  const unknownField = ownEnumerableFields(value, path).find(
    (field) => !allowedFields.has(field)
  )
  if (unknownField !== undefined) {
    throw new Error(`${path}.${unknownField} is not supported`)
  }
}

function readIdentifier(
  value: unknown,
  path: string,
  pattern = identifierPattern
): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${path} must be a non-empty identifier`)
  }
  return value
}

function isSensitiveField(field: string): boolean {
  const normalized = field.toLowerCase().replaceAll(/[^a-z0-9]/g, '')
  return sensitiveFieldFragments.some((fragment) =>
    normalized.includes(fragment)
  )
}

function stringLiteral(value: string): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error('string is not JSON-compatible')
  return encoded
}

function canonicalize(
  value: unknown,
  path: string,
  ancestors: ReadonlySet<object>
): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return stringLiteral(value)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error(`${path} must be a finite number`)
    return Object.is(value, -0) ? '0' : String(value)
  }

  let isArray: boolean
  try {
    isArray = Array.isArray(value)
  } catch (error) {
    throw new Error(`${path} must be stable JSON data`, { cause: error })
  }

  if (isArray) {
    const arrayValue = value as object
    if (ancestors.has(arrayValue)) throw new Error(`${path} contains a cycle`)
    const nextAncestors = new Set(ancestors).add(arrayValue)
    const items: string[] = []
    let length: number
    try {
      const descriptor = Object.getOwnPropertyDescriptor(arrayValue, 'length')
      if (
        descriptor === undefined ||
        !('value' in descriptor) ||
        typeof descriptor.value !== 'number'
      ) {
        throw new Error(`${path} must expose a stable length`)
      }
      length = descriptor.value
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(path)) throw error
      throw new Error(`${path} must expose a stable length`, { cause: error })
    }
    for (let index = 0; index < length; index += 1) {
      const itemPath = `${path}[${index}]`
      items.push(
        canonicalize(
          ownDataValue(arrayValue, String(index), itemPath),
          itemPath,
          nextAncestors
        )
      )
    }
    return `[${items.join(',')}]`
  }

  if (!isPlainObject(value)) {
    if (typeof value === 'object' && value !== null) {
      throw new Error(`${path} must be a plain object`)
    }
    throw new Error(`${path} is not JSON-compatible`)
  }

  if (ancestors.has(value)) throw new Error(`${path} contains a cycle`)
  const nextAncestors = new Set(ancestors).add(value)
  const fields = [...ownEnumerableFields(value, path)].sort()

  return `{${fields
    .map((field) => {
      const fieldPath = `${path}.${field}`
      if (isSensitiveField(field)) {
        throw new Error(
          `sensitive query parameter field: ${fieldPath.slice(7)}`
        )
      }
      return `${stringLiteral(field)}:${canonicalize(ownDataValue(value, field, fieldPath), fieldPath, nextAncestors)}`
    })
    .join(',')}}`
}

/** Builds a deterministic, tenant-safe key without interpreting opaque cursors. */
export function createQueryKey(input: unknown): AdminQueryKey {
  if (!isPlainObject(input)) throw new Error('input must be an object')
  assertExactFields(input, inputFields, 'input')

  const identityId = readIdentifier(
    ownDataValue(input, 'identityId', 'identityId'),
    'identityId'
  )
  const contractVersion = readIdentifier(
    ownDataValue(input, 'contractVersion', 'contractVersion'),
    'contractVersion'
  )
  const domain = readIdentifier(
    ownDataValue(input, 'domain', 'domain'),
    'domain',
    operationPattern
  )
  const operation = readIdentifier(
    ownDataValue(input, 'operation', 'operation'),
    'operation',
    operationPattern
  )

  const scope = ownDataValue(input, 'scope', 'scope')
  if (!isPlainObject(scope)) throw new Error('scope must be an object')
  const scopeType = readIdentifier(
    ownDataValue(scope, 'type', 'scope.type'),
    'scope.type',
    operationPattern
  )
  const allowedScopeFields =
    scopeType === 'platform' ? new Set(['type']) : scopeFields
  assertExactFields(scope, allowedScopeFields, 'scope')
  if (!['platform', 'organization', 'site'].includes(scopeType)) {
    throw new Error(`unsupported scope.type: ${scopeType}`)
  }
  const scopeId =
    scopeType === 'platform'
      ? '-'
      : readIdentifier(ownDataValue(scope, 'id', 'scope.id'), 'scope.id')

  const params = ownDataValue(input, 'params', 'params')
  if (!isPlainObject(params)) throw new Error('params must be an object')
  const canonicalParams = canonicalize(params, 'params', new Set())

  return [
    'kokoro.admin.query.v1',
    contractVersion,
    identityId,
    scopeType,
    scopeId,
    domain,
    operation,
    canonicalParams,
  ]
}
