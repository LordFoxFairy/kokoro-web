import { z } from 'zod'
import {
  accessCheckSchema,
  auditEventSchema,
  capabilityProjectionSchema,
  currentIdentitySchema,
  dashboardSummarySchema,
  memberSchema,
  organizationSchema,
  permissionSchema,
  roleSchema,
  sessionSchema,
  siteSchema,
  userSchema,
} from './entities'
import { dataResultSchema, pageSchema } from './schema'

export const identityResultSchema = dataResultSchema(currentIdentitySchema)
export const capabilityResultSchema = dataResultSchema(
  capabilityProjectionSchema
)
export const dashboardResultSchema = dataResultSchema(dashboardSummarySchema)

export const userPageResultSchema = dataResultSchema(pageSchema(userSchema))
export const userResultSchema = dataResultSchema(userSchema)
export const organizationPageResultSchema = dataResultSchema(
  pageSchema(organizationSchema)
)
export const organizationResultSchema = dataResultSchema(organizationSchema)
export const sitePageResultSchema = dataResultSchema(pageSchema(siteSchema))
export const siteResultSchema = dataResultSchema(siteSchema)
export const memberPageResultSchema = dataResultSchema(pageSchema(memberSchema))
export const rolePageResultSchema = dataResultSchema(pageSchema(roleSchema))
export const roleResultSchema = dataResultSchema(roleSchema)
export const permissionListResultSchema = dataResultSchema(
  z.array(permissionSchema).max(10_000).readonly()
)
export const sessionPageResultSchema = dataResultSchema(
  pageSchema(sessionSchema)
)
export const sessionResultSchema = dataResultSchema(sessionSchema)
export const auditPageResultSchema = dataResultSchema(
  pageSchema(auditEventSchema)
)
export const auditEventResultSchema = dataResultSchema(auditEventSchema)
export const accessCheckResultSchema = dataResultSchema(accessCheckSchema)
