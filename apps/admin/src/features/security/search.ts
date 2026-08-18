import { z } from 'zod'

export type SearchParamValue = string | readonly string[] | undefined
export type SearchParamRecord = Readonly<Record<string, SearchParamValue>>
export type SearchParamSource = SearchParamRecord | URLSearchParams

const searchTextSchema = z.string().trim().min(1).max(200)
const identifierSchema = z.string().trim().min(1).max(128)

const sessionStatusSchema = z.enum(['active', 'expired', 'revoked', 'unknown'])
const auditOutcomeSchema = z.enum(['success', 'denied', 'failure', 'unknown'])
const scopeTypeSchema = z.enum(['platform', 'organization', 'site'])

export const sessionSearchSchema = z
  .object({
    q: searchTextSchema.optional(),
    userId: identifierSchema.optional(),
    status: z.array(sessionStatusSchema).default([]),
  })
  .strict()

export const auditSearchSchema = z
  .object({
    q: searchTextSchema.optional(),
    actorId: identifierSchema.optional(),
    targetId: identifierSchema.optional(),
    requestId: identifierSchema.optional(),
    outcome: z.array(auditOutcomeSchema).default([]),
    scopeType: z.array(scopeTypeSchema).default([]),
    scopeId: identifierSchema.optional(),
  })
  .strict()

export type SessionSearch = z.infer<typeof sessionSearchSchema>
export type AuditSearch = z.infer<typeof auditSearchSchema>
export type SessionSearchInput = Omit<Partial<SessionSearch>, 'status'> & {
  readonly status?: readonly SessionSearch['status'][number][]
}
export type AuditSearchInput = Omit<
  Partial<AuditSearch>,
  'outcome' | 'scopeType'
> & {
  readonly outcome?: readonly AuditSearch['outcome'][number][]
  readonly scopeType?: readonly AuditSearch['scopeType'][number][]
}

function valuesFor(source: SearchParamSource, key: string): readonly string[] {
  if (source instanceof URLSearchParams) return source.getAll(key)

  const value = source[key]
  if (typeof value === 'string') return [value]
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function parseSingle(
  source: SearchParamSource,
  key: string,
  schema: z.ZodString
): string | undefined {
  for (const value of valuesFor(source, key)) {
    const parsed = schema.safeParse(value)
    if (parsed.success) return parsed.data
  }
  return undefined
}

function parseMany<T extends string>(
  source: SearchParamSource,
  key: string,
  schema: z.ZodType<T>
): T[] {
  const values = valuesFor(source, key).flatMap((value) => value.split(','))
  const parsed = values.flatMap((value) => {
    const result = schema.safeParse(value.trim())
    return result.success ? [result.data] : []
  })
  return [...new Set(parsed)]
}

export function parseSessionSearchParams(
  source: SearchParamSource
): SessionSearch {
  return sessionSearchSchema.parse({
    q: parseSingle(source, 'q', searchTextSchema),
    userId: parseSingle(source, 'userId', identifierSchema),
    status: parseMany(source, 'status', sessionStatusSchema),
  })
}

export function serializeSessionSearchParams(
  search: SessionSearchInput
): URLSearchParams {
  const parsed = sessionSearchSchema.parse({
    q: search.q,
    userId: search.userId,
    status: search.status ?? [],
  })
  return serialize({
    q: parsed.q,
    userId: parsed.userId,
    status: parsed.status,
  })
}

export function parseAuditSearchParams(source: SearchParamSource): AuditSearch {
  return auditSearchSchema.parse({
    q: parseSingle(source, 'q', searchTextSchema),
    actorId: parseSingle(source, 'actorId', identifierSchema),
    targetId: parseSingle(source, 'targetId', identifierSchema),
    requestId: parseSingle(source, 'requestId', identifierSchema),
    outcome: parseMany(source, 'outcome', auditOutcomeSchema),
    scopeType: parseMany(source, 'scopeType', scopeTypeSchema),
    scopeId: parseSingle(source, 'scopeId', identifierSchema),
  })
}

export function serializeAuditSearchParams(
  search: AuditSearchInput
): URLSearchParams {
  const parsed = auditSearchSchema.parse({
    q: search.q,
    actorId: search.actorId,
    targetId: search.targetId,
    requestId: search.requestId,
    outcome: search.outcome ?? [],
    scopeType: search.scopeType ?? [],
    scopeId: search.scopeId,
  })
  return serialize(parsed)
}

function serialize(
  values: Readonly<Record<string, string | readonly string[] | undefined>>
): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item)
    } else if (typeof value === 'string') {
      params.set(key, value)
    }
  }
  return params
}

export const parseSessionsSearch = parseSessionSearchParams
export const serializeSessionsSearch = serializeSessionSearchParams
export const parseAuditSearch = parseAuditSearchParams
export const serializeAuditSearch = serializeAuditSearchParams
