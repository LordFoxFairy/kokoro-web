import { z } from 'zod'
import { ADMIN_FIXTURE_SCHEMA_VERSION } from './common'

const CODE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const MAX_PAGE_ITEMS = 100
const MAX_FIELD_VIOLATIONS = 100
const MAX_OPAQUE_TOKEN_LENGTH = 4_096
const MAX_FIELD_PATH_LENGTH = 512
const MAX_SAFE_MESSAGE_LENGTH = 2_000
const ISO_INSTANT =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/

function isInstant(value: string): boolean {
  const match = ISO_INSTANT.exec(value)
  if (match === null || Number.isNaN(new Date(value).getTime())) return false

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ][month - 1]

  return daysInMonth !== undefined && day >= 1 && day <= daysInMonth
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0)
    if (code !== undefined && (code <= 0x1f || code === 0x7f)) return true
  }
  return false
}

const codeSchema = z.string().regex(CODE)
const nonEmptyStringSchema = z.string().min(1)
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe()

export const entityIdSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !hasControlCharacter(value), 'Invalid opaque identifier')
export const instantSchema = z
  .string()
  .max(40)
  .refine(isInstant, 'Invalid ISO instant')
export const opaqueStringSchema = nonEmptyStringSchema
  .max(MAX_OPAQUE_TOKEN_LENGTH)
  .refine(
    (value) => value === value.trim() && !hasControlCharacter(value),
    'Invalid opaque string'
  )
export function boundedTextSchema(maxLength = 256) {
  return nonEmptyStringSchema
    .max(maxLength)
    .refine((value) => !hasControlCharacter(value), 'Invalid text')
}

export const scopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('platform') }).strict(),
  z.object({ type: z.literal('organization'), id: entityIdSchema }).strict(),
  z.object({ type: z.literal('site'), id: entityIdSchema }).strict(),
])

export const sortDirectionSchema = z.enum(['asc', 'desc'])

export const sortSchema = z
  .object({
    field: codeSchema,
    direction: sortDirectionSchema,
  })
  .strict()

export function pageSchema<ItemSchema extends z.ZodType>(
  itemSchema: ItemSchema
) {
  return z
    .object({
      items: z.array(itemSchema).max(MAX_PAGE_ITEMS).readonly(),
      nextPageToken: opaqueStringSchema.optional(),
      totalCount: nonNegativeIntegerSchema.optional(),
    })
    .strict()
}

export function dataResultSchema<DataSchema extends z.ZodType>(
  dataSchema: DataSchema
) {
  return z
    .object({
      data: dataSchema,
      requestId: entityIdSchema,
      schemaVersion: z.literal(ADMIN_FIXTURE_SCHEMA_VERSION),
    })
    .strict()
}

export const adminErrorCodeSchema = z.enum([
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

export const fieldViolationSchema = z
  .object({
    path: boundedTextSchema(MAX_FIELD_PATH_LENGTH),
    code: codeSchema,
  })
  .strict()

export const adminErrorSchema = z
  .object({
    kind: z.literal('admin-data-error'),
    code: adminErrorCodeSchema,
    businessCode: codeSchema.optional(),
    fieldViolations: z.array(fieldViolationSchema).max(MAX_FIELD_VIOLATIONS),
    requestId: entityIdSchema,
    retryAfterMs: nonNegativeIntegerSchema.optional(),
    safeMessage: boundedTextSchema(MAX_SAFE_MESSAGE_LENGTH).optional(),
  })
  .strict()

export function isAdminError(value: unknown): boolean {
  return parseAdminError(value) !== undefined
}

const adminErrorControlSchema = z.object({
  kind: z.literal('admin-data-error'),
  code: adminErrorCodeSchema,
  businessCode: z.string().optional().catch(undefined),
  fieldViolations: z
    .array(fieldViolationSchema)
    .max(MAX_FIELD_VIOLATIONS)
    .catch([]),
  requestId: z
    .string()
    .min(1)
    .transform((value) =>
      entityIdSchema.safeParse(value).success ? value : 'invalid-request-id'
    ),
  retryAfterMs: nonNegativeIntegerSchema.optional().catch(undefined),
})

export function parseAdminError(
  value: unknown
): z.infer<typeof adminErrorControlSchema> | undefined {
  try {
    const result = adminErrorControlSchema.safeParse(value)
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}
