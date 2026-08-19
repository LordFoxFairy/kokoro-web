import type { z } from 'zod'
import type { PageError, PageState } from './page-state'

type JsonPrimitive = string | number | boolean | null

export type JsonReadonly<Value> = Value extends JsonPrimitive
  ? Value
  : Value extends readonly (infer Item)[]
    ? readonly JsonReadonly<Item>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: JsonReadonly<Value[Key]> }
      : never

export type PageProps<Data> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly data: JsonReadonly<Data> }
  | { readonly status: 'empty' }
  | { readonly status: 'error'; readonly error: PageError }
  | {
      readonly status: 'unauthenticated'
      readonly error: PageError<'UNAUTHENTICATED'>
    }
  | {
      readonly status: 'forbidden'
      readonly error: PageError<'PERMISSION_DENIED'>
    }
  | { readonly status: 'not-found'; readonly error: PageError<'NOT_FOUND'> }
  | {
      readonly status: 'partial'
      readonly data: JsonReadonly<Data>
      readonly error: PageError
    }

const unsafeObjectKey = /^(?:__proto__|prototype|constructor)$/i
const MAX_DEPTH = 64
const MAX_NODES = 100_000
const errorCodes = new Set<PageError['code']>([
  'UNAUTHENTICATED',
  'PERMISSION_DENIED',
  'INVALID_ARGUMENT',
  'NOT_FOUND',
  'ALREADY_EXISTS',
  'FAILED_PRECONDITION',
  'RESOURCE_EXHAUSTED',
  'UNAVAILABLE',
  'DEADLINE_EXCEEDED',
  'UNKNOWN',
])

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
  if (['pagetoken', 'nextpagetoken'].includes(normalized)) return false

  const sensitiveCompounds = [
    'accesstoken',
    'refreshtoken',
    'sessiontoken',
    'idtoken',
    'authtoken',
    'bearertoken',
    'privatekey',
    'apikey',
    'setcookie',
    'clientsecret',
  ]
  const safeMetricSuffixes = new Set([
    'count',
    'usage',
    'limit',
    'budget',
    'type',
    'status',
  ])
  for (const term of sensitiveCompounds) {
    const position = normalized.indexOf(term)
    if (position === -1) continue
    const suffix = normalized.slice(position + term.length)
    if (!safeMetricSuffixes.has(suffix)) return true
  }

  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  const hasUnsafeWord = (word: string, allowedSuffixes: readonly string[]) =>
    words.some((candidate, index) => {
      if (candidate !== word) return false
      const suffix = words.slice(index + 1)
      return suffix.length !== 1 || !allowedSuffixes.includes(suffix[0] ?? '')
    })

  if (
    words.some((word) =>
      ['authorization', 'password', 'passwd', 'secret'].includes(word)
    )
  ) {
    return true
  }
  if (hasUnsafeWord('token', ['count', 'usage', 'limit', 'budget'])) return true
  if (hasUnsafeWord('cookie', ['consent', 'policy', 'preference'])) return true
  return hasUnsafeWord('credential', ['type', 'status'])
}

type CloneContext = {
  readonly ancestors: Set<object>
  nodes: number
}

function fail(reason?: unknown): never {
  throw new Error('Page state is not safe for client props', {
    cause: reason,
  })
}

function ownKeys(value: object): readonly (string | symbol)[] {
  try {
    return Reflect.ownKeys(value)
  } catch (error) {
    return fail(error)
  }
}

function descriptor(value: object, key: PropertyKey): PropertyDescriptor {
  try {
    const result = Object.getOwnPropertyDescriptor(value, key)
    if (result === undefined || !('value' in result)) return fail()
    return result
  } catch (error) {
    return fail(error)
  }
}

function prototypeOf(value: object): object | null {
  try {
    return Object.getPrototypeOf(value)
  } catch (error) {
    return fail(error)
  }
}

function cloneJson(value: unknown, context: CloneContext, depth = 0): unknown {
  context.nodes += 1
  if (depth > MAX_DEPTH || context.nodes > MAX_NODES) return fail()
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? (Object.is(value, -0) ? 0 : value) : fail()
  }
  if (typeof value !== 'object') return fail()
  if (context.ancestors.has(value)) return fail()

  let isArray: boolean
  try {
    isArray = Array.isArray(value)
  } catch (error) {
    return fail(error)
  }

  const expectedPrototype = isArray ? Array.prototype : Object.prototype
  const prototype = prototypeOf(value)
  if (prototype !== expectedPrototype && !(prototype === null && !isArray)) {
    return fail()
  }

  const nextContext: CloneContext = {
    ancestors: new Set(context.ancestors).add(value),
    nodes: context.nodes,
  }

  if (isArray) {
    const keys = ownKeys(value)
    if (keys.some((key) => typeof key === 'symbol')) return fail()
    const length = descriptor(value, 'length').value
    if (!Number.isSafeInteger(length) || length < 0) return fail()
    if (
      keys.length !== length + 1 ||
      keys.some(
        (key) =>
          key !== 'length' &&
          (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/.test(key))
      )
    ) {
      return fail()
    }

    const result: unknown[] = []
    for (let index = 0; index < length; index += 1) {
      const item = descriptor(value, String(index))
      if (!item.enumerable) return fail()
      result.push(cloneJson(item.value, nextContext, depth + 1))
      context.nodes = nextContext.nodes
    }
    return result
  }

  const result: Record<string, unknown> = {}
  for (const key of ownKeys(value)) {
    if (typeof key !== 'string') return fail()
    if (unsafeObjectKey.test(key) || isSensitiveKey(key)) return fail()
    const property = descriptor(value, key)
    if (!property.enumerable) return fail()
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: cloneJson(property.value, nextContext, depth + 1),
      writable: true,
    })
    context.nodes = nextContext.nodes
  }
  return result
}

function safeClone(value: unknown): unknown {
  return cloneJson(value, { ancestors: new Set(), nodes: 0 })
}

function freezeJson<Value>(value: Value): Readonly<Value> {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) freezeJson(child)
  return Object.freeze(value)
}

function projectError<Code extends PageError['code'] = PageError['code']>(
  value: unknown,
  expectedCode?: Code
): PageError<Code> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail()
  }
  const source = value as Partial<PageError>
  if (
    source.code === undefined ||
    !errorCodes.has(source.code) ||
    (expectedCode !== undefined && source.code !== expectedCode) ||
    typeof source.requestId !== 'string' ||
    typeof source.retryable !== 'boolean' ||
    !Array.isArray(source.fieldViolations)
  ) {
    return fail()
  }
  if (
    source.businessCode !== undefined &&
    typeof source.businessCode !== 'string'
  ) {
    return fail()
  }
  if (
    source.retryAfterMs !== undefined &&
    (!Number.isSafeInteger(source.retryAfterMs) || source.retryAfterMs < 0)
  ) {
    return fail()
  }

  const fieldViolations = source.fieldViolations.map((violation) => {
    if (
      typeof violation !== 'object' ||
      violation === null ||
      typeof violation.path !== 'string' ||
      typeof violation.code !== 'string'
    ) {
      return fail()
    }
    return Object.freeze({ path: violation.path, code: violation.code })
  })
  return Object.freeze({
    code: source.code as Code,
    ...(source.businessCode === undefined
      ? {}
      : { businessCode: source.businessCode }),
    fieldViolations: Object.freeze(fieldViolations),
    requestId: source.requestId,
    retryable: source.retryable,
    ...(source.retryAfterMs === undefined
      ? {}
      : { retryAfterMs: source.retryAfterMs }),
  })
}

function projectData<Schema extends z.ZodType>(
  value: unknown,
  schema: Schema
): JsonReadonly<z.output<Schema>> {
  const result = schema.safeParse(value)
  if (!result.success) throw new Error('Invalid page data')
  let cloned: unknown
  try {
    cloned = safeClone(result.data)
  } catch (error) {
    throw new Error('Page data schema produced unsafe client props', {
      cause: error,
    })
  }
  return freezeJson(cloned) as JsonReadonly<z.output<Schema>>
}

/** Projects server-owned page state into immutable, JSON-safe Client props. */
export function projectPageProps<Schema extends z.ZodType>(
  state: PageState<unknown>,
  dataSchema: Schema
): PageProps<z.output<Schema>> {
  const clonedState = safeClone(state) as PageState<unknown>

  switch (clonedState.status) {
    case 'loading':
      return Object.freeze({ status: 'loading' })
    case 'ready':
      return Object.freeze({
        status: 'ready',
        data: projectData(clonedState.data, dataSchema),
      })
    case 'empty':
      return Object.freeze({ status: 'empty' })
    case 'error':
      return Object.freeze({
        status: 'error',
        error: projectError(clonedState.error),
      })
    case 'unauthenticated':
      return Object.freeze({
        status: 'unauthenticated',
        error: projectError(clonedState.error, 'UNAUTHENTICATED'),
      })
    case 'forbidden':
      return Object.freeze({
        status: 'forbidden',
        error: projectError(clonedState.error, 'PERMISSION_DENIED'),
      })
    case 'not-found':
      return Object.freeze({
        status: 'not-found',
        error: projectError(clonedState.error, 'NOT_FOUND'),
      })
    case 'partial':
      return Object.freeze({
        status: 'partial',
        data: projectData(clonedState.data, dataSchema),
        error: projectError(clonedState.error),
      })
    default:
      return fail()
  }
}
