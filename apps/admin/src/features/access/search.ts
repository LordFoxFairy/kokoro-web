import { z } from 'zod'

export type SearchParamValue = string | readonly string[] | undefined
export type SearchParamsInput = Readonly<Record<string, SearchParamValue>>
export type SearchParamSource = SearchParamsInput | URLSearchParams

const optionalSearchValue = z.string().trim().min(1).optional()
const scopeTypeSchema = z.enum(['platform', 'organization', 'site'])

export const rolesSearchSchema = z.object({
  scopeType: scopeTypeSchema.optional(),
  scopeId: optionalSearchValue,
  roleId: optionalSearchValue,
  includeDeleted: z.boolean().default(false),
  q: optionalSearchValue,
})

export const accessSearchSchema = z.object({
  subjectId: optionalSearchValue,
  scopeType: scopeTypeSchema.optional(),
  scopeId: optionalSearchValue,
  resource: optionalSearchValue,
  action: optionalSearchValue,
})

export type RolesSearch = z.infer<typeof rolesSearchSchema>
export type AccessSearch = z.infer<typeof accessSearchSchema>

export const DEFAULT_ROLES_SEARCH: RolesSearch = Object.freeze({
  includeDeleted: false,
})

export const DEFAULT_ACCESS_SEARCH: AccessSearch = Object.freeze({})

function firstStringValue(value: SearchParamValue): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value
  const trimmed = candidate?.trim()
  return trimmed ? trimmed : undefined
}

function firstString(
  source: SearchParamSource,
  key: string
): string | undefined {
  return source instanceof URLSearchParams
    ? firstStringValue(source.get(key) ?? undefined)
    : firstStringValue(source[key])
}

function scopeFrom(input: SearchParamSource) {
  const scopeType = scopeTypeSchema.safeParse(firstString(input, 'scopeType'))
  const scopeId = firstString(input, 'scopeId')

  if (!scopeType.success) return {}
  if (scopeType.data === 'platform') return { scopeType: 'platform' as const }
  if (!scopeId) return {}

  return { scopeType: scopeType.data, scopeId }
}

export function parseRolesSearch(input: SearchParamSource): RolesSearch {
  const parsed = rolesSearchSchema.safeParse({
    ...scopeFrom(input),
    roleId: firstString(input, 'roleId'),
    includeDeleted: firstString(input, 'includeDeleted') === 'true',
    q: firstString(input, 'q'),
  })

  return parsed.success ? parsed.data : { ...DEFAULT_ROLES_SEARCH }
}

export function serializeRolesSearch(search: RolesSearch): URLSearchParams {
  const parsed = rolesSearchSchema.safeParse(search)
  const output = new URLSearchParams()
  if (!parsed.success) return output

  if (parsed.data.scopeType === 'platform') {
    output.set('scopeType', 'platform')
  } else if (parsed.data.scopeType && parsed.data.scopeId) {
    output.set('scopeType', parsed.data.scopeType)
    output.set('scopeId', parsed.data.scopeId)
  }
  if (parsed.data.roleId) output.set('roleId', parsed.data.roleId)
  if (parsed.data.includeDeleted) output.set('includeDeleted', 'true')
  if (parsed.data.q) output.set('q', parsed.data.q)
  return output
}

export function parseAccessSearch(input: SearchParamSource): AccessSearch {
  const parsed = accessSearchSchema.safeParse({
    subjectId: firstString(input, 'subjectId'),
    ...scopeFrom(input),
    resource: firstString(input, 'resource'),
    action: firstString(input, 'action'),
  })

  return parsed.success ? parsed.data : { ...DEFAULT_ACCESS_SEARCH }
}

export function serializeAccessSearch(search: AccessSearch): URLSearchParams {
  const parsed = accessSearchSchema.safeParse(search)
  const output = new URLSearchParams()
  if (!parsed.success) return output

  if (parsed.data.subjectId) output.set('subjectId', parsed.data.subjectId)
  if (parsed.data.scopeType === 'platform') {
    output.set('scopeType', 'platform')
  } else if (parsed.data.scopeType && parsed.data.scopeId) {
    output.set('scopeType', parsed.data.scopeType)
    output.set('scopeId', parsed.data.scopeId)
  }
  if (parsed.data.resource) output.set('resource', parsed.data.resource)
  if (parsed.data.action) output.set('action', parsed.data.action)
  return output
}
