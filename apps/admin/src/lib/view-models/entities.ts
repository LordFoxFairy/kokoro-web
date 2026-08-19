import { z } from 'zod'
import {
  ADMIN_FIXTURE_SCHEMA_VERSION,
  type CapabilityProjection,
} from './common'
import type {
  AccessCheck,
  AuditEvent,
  CurrentIdentity,
  DashboardSummary,
  Member,
  Organization,
  Permission,
  Role,
  Session,
  Site,
  User,
} from './models'
import {
  boundedTextSchema,
  entityIdSchema,
  instantSchema,
  opaqueStringSchema,
  scopeSchema,
} from './schema'

// Transport-width guard only; authoritative business limits belong to IAM.
const MAX_UNPAGED_COLLECTION_SIZE = 10_000
const blockedObjectKey = /^(?:__proto__|prototype|constructor)$/i
const shortTextSchema = boundedTextSchema(256)
const longTextSchema = boundedTextSchema(1000)
const emailSchema = z.email().max(254)
const nonNegativeIntegerSchema = z.number().int().nonnegative().safe()
function isSensitiveAttributeKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
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
  const hasPair = (left: string, right: string) =>
    words.some((word, index) => word === left && words[index + 1] === right)
  const hasUnsafeWord = (word: string, allowedSuffixes: readonly string[]) =>
    words.some((candidate, index) => {
      if (candidate !== word) return false
      const suffix = words.slice(index + 1)
      return suffix.length !== 1 || !allowedSuffixes.includes(suffix[0] ?? '')
    })

  if (words.includes('authorization') || words.includes('password')) return true
  if (words.includes('secret')) return true
  if (hasPair('private', 'key') || hasPair('api', 'key')) return true
  if (hasPair('set', 'cookie')) return true
  if (hasUnsafeWord('token', ['count', 'usage', 'limit', 'budget'])) {
    return true
  }
  if (hasUnsafeWord('cookie', ['consent', 'policy', 'preference'])) {
    return true
  }
  return hasUnsafeWord('credential', ['type', 'status'])
}
const auditAttributeKeySchema = boundedTextSchema(128).refine(
  (key) => !blockedObjectKey.test(key) && !isSensitiveAttributeKey(key),
  'Unsafe audit attribute key'
)
const auditAttributesSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return value
    }
    return Object.getOwnPropertyNames(value).some((key) =>
      blockedObjectKey.test(key)
    )
      ? null
      : value
  },
  z
    .record(auditAttributeKeySchema, boundedTextSchema(1000))
    .superRefine((attributes, context) => {
      if (Object.keys(attributes).length > 32) {
        context.addIssue({ code: 'custom', message: 'Too many attributes' })
      }
    })
)

const entityStatusSchema = z.enum(['active', 'suspended', 'deleted', 'unknown'])

const capabilitySchema = z
  .object({
    key: opaqueStringSchema,
    scope: scopeSchema,
  })
  .strict()

export const userSchema: z.ZodType<User> = z
  .object({
    id: entityIdSchema,
    displayName: shortTextSchema,
    email: emailSchema,
    status: entityStatusSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict()

export const organizationSchema: z.ZodType<Organization> = z
  .object({
    id: entityIdSchema,
    name: shortTextSchema,
    slug: opaqueStringSchema,
    status: entityStatusSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict()

export const siteSchema: z.ZodType<Site> = z
  .object({
    id: entityIdSchema,
    organizationId: entityIdSchema,
    name: shortTextSchema,
    slug: opaqueStringSchema,
    status: entityStatusSchema,
    createdAt: instantSchema,
    updatedAt: instantSchema,
  })
  .strict()

export const memberSchema: z.ZodType<Member> = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    scope: scopeSchema,
    roleIds: z.array(entityIdSchema).max(MAX_UNPAGED_COLLECTION_SIZE),
    status: entityStatusSchema,
    joinedAt: instantSchema,
  })
  .strict()

export const permissionSchema: z.ZodType<Permission> = z
  .object({
    key: opaqueStringSchema,
    group: shortTextSchema,
    label: shortTextSchema,
    description: longTextSchema.optional(),
  })
  .strict()

export const roleSchema: z.ZodType<Role> = z
  .object({
    id: entityIdSchema,
    scope: scopeSchema,
    name: shortTextSchema,
    description: longTextSchema.optional(),
    status: entityStatusSchema,
    builtIn: z.boolean(),
    memberCount: nonNegativeIntegerSchema,
    permissionKeys: z
      .array(opaqueStringSchema)
      .max(MAX_UNPAGED_COLLECTION_SIZE),
    updatedAt: instantSchema,
  })
  .strict()

export const sessionSchema: z.ZodType<Session> = z
  .object({
    id: entityIdSchema,
    userId: entityIdSchema,
    status: z.enum(['active', 'expired', 'revoked', 'unknown']),
    clientLabel: shortTextSchema,
    ipAddress: opaqueStringSchema.optional(),
    createdAt: instantSchema,
    lastActiveAt: instantSchema,
    expiresAt: instantSchema,
    revokedAt: instantSchema.optional(),
  })
  .strict()

export const auditEventSchema: z.ZodType<AuditEvent> = z
  .object({
    id: entityIdSchema,
    occurredAt: instantSchema,
    actorId: entityIdSchema.optional(),
    action: opaqueStringSchema,
    targetType: opaqueStringSchema,
    targetId: entityIdSchema.optional(),
    scope: scopeSchema.optional(),
    outcome: z.enum(['success', 'denied', 'failure', 'unknown']),
    commandId: entityIdSchema.optional(),
    requestId: entityIdSchema,
    attributes: auditAttributesSchema,
  })
  .strict()

export const accessCheckSchema: z.ZodType<AccessCheck> = z
  .object({
    subjectId: entityIdSchema,
    scope: scopeSchema,
    resource: opaqueStringSchema,
    action: opaqueStringSchema,
    allowed: z.boolean(),
    checkedAt: instantSchema,
    reasonCode: opaqueStringSchema,
    evidence: z.array(longTextSchema).max(MAX_UNPAGED_COLLECTION_SIZE),
  })
  .strict()

const dashboardMetricSchema = z
  .object({
    key: z.enum([
      'users',
      'organizations',
      'sites',
      'activeSessions',
      'securityEvents',
    ]),
    value: nonNegativeIntegerSchema,
    windowLabel: shortTextSchema,
    targetPath: boundedTextSchema(2048).refine(
      (path) =>
        path.startsWith('/') && !path.startsWith('//') && !path.includes('\\'),
      'Invalid internal path'
    ),
  })
  .strict()

export const dashboardSummarySchema: z.ZodType<DashboardSummary> = z
  .object({
    generatedAt: instantSchema,
    sections: z
      .object({
        metrics: z.enum(['ready', 'unavailable']),
        recentAudit: z.enum(['ready', 'unavailable']),
      })
      .strict(),
    metrics: z.array(dashboardMetricSchema).max(16),
    recentAudit: z.array(auditEventSchema).max(MAX_UNPAGED_COLLECTION_SIZE),
  })
  .strict()

export const currentIdentitySchema: z.ZodType<CurrentIdentity> = z
  .object({
    id: entityIdSchema,
    displayName: shortTextSchema,
    email: emailSchema,
    capabilities: z.array(capabilitySchema).max(MAX_UNPAGED_COLLECTION_SIZE),
  })
  .strict()

export const capabilityProjectionSchema: z.ZodType<CapabilityProjection> = z
  .object({
    schemaVersion: z.literal(ADMIN_FIXTURE_SCHEMA_VERSION),
    subjectId: entityIdSchema,
    capabilities: z.array(capabilitySchema).max(MAX_UNPAGED_COLLECTION_SIZE),
    projectedAt: instantSchema,
  })
  .strict()
