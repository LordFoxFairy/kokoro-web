const stringFields = [
  'requestId',
  'method',
  'code',
  'scopeType',
  'targetType',
] as const

const numberFields = ['status', 'durationMs', 'count'] as const

const stringRules = {
  requestId: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/,
  method: /^[A-Za-z][A-Za-z0-9./_-]{0,127}$/,
  code: /^[A-Z][A-Z0-9_]{0,63}$/,
  scopeType: /^[a-z][a-z0-9_-]{0,63}$/,
  targetType: /^[a-z][a-z0-9_-]{0,63}$/,
} as const satisfies Readonly<Record<StringField, RegExp>>

type StringField = (typeof stringFields)[number]
type NumberField = (typeof numberFields)[number]

export type SafeLogContext = Readonly<
  Partial<Record<StringField, string>> & Partial<Record<NumberField, number>>
>

const emptyContext: SafeLogContext = Object.freeze({})

function isRecordCandidate(input: unknown): input is object {
  if (typeof input !== 'object' || input === null) return false
  try {
    return !Array.isArray(input)
  } catch {
    return false
  }
}

function ownDataValue(input: object, field: PropertyKey): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, field)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

/** Reduces untrusted metadata to the scalar fields approved for logs. */
export function sanitizeLogContext(input: unknown): SafeLogContext {
  if (!isRecordCandidate(input)) return emptyContext

  const result: Partial<Record<StringField | NumberField, string | number>> = {}

  for (const field of stringFields) {
    const value = ownDataValue(input, field)
    if (typeof value === 'string' && stringRules[field].test(value)) {
      result[field] = value
    }
  }

  for (const field of numberFields) {
    const value = ownDataValue(input, field)
    if (
      typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      result[field] = value
    }
  }

  return Object.freeze(result) as SafeLogContext
}
