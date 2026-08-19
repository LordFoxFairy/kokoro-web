import { z } from 'zod'
import type { AccessCheckInput } from './models'
import {
  boundedTextSchema,
  entityIdSchema,
  opaqueStringSchema,
  scopeSchema,
  sortSchema,
} from './schema'

const pageRequestShape = {
  pageSize: z.number().int().min(1).max(100).safe().optional(),
  pageToken: opaqueStringSchema.optional(),
  query: boundedTextSchema(200).optional(),
  sort: sortSchema.optional(),
}

const entityStatusSchema = z.enum(['active', 'suspended', 'deleted', 'unknown'])
const sessionStatusSchema = z.enum(['active', 'expired', 'revoked', 'unknown'])
const auditOutcomeSchema = z.enum(['success', 'denied', 'failure', 'unknown'])

export const accessCheckInputSchema: z.ZodType<AccessCheckInput> = z
  .object({
    subjectId: entityIdSchema,
    scope: scopeSchema,
    resource: opaqueStringSchema,
    action: opaqueStringSchema,
  })
  .strict()

export const statusPageRequestSchema = z
  .object({
    ...pageRequestShape,
    statuses: z.array(entityStatusSchema).max(4).optional(),
  })
  .strict()

export const scopePageRequestSchema = z
  .object({ ...pageRequestShape, scope: scopeSchema })
  .strict()

export const sessionPageRequestSchema = z
  .object({
    ...pageRequestShape,
    userId: entityIdSchema.optional(),
    statuses: z.array(sessionStatusSchema).max(4).optional(),
  })
  .strict()

export const auditPageRequestSchema = z
  .object({
    ...pageRequestShape,
    actorId: entityIdSchema.optional(),
    targetId: entityIdSchema.optional(),
    requestId: entityIdSchema.optional(),
    outcomes: z.array(auditOutcomeSchema).max(4).optional(),
    scope: scopeSchema.optional(),
  })
  .strict()
