import { describe, expect, it } from 'vitest'
import { FixtureAdminDataClient } from '../fixtures/client'
import {
  accessCheckResultSchema,
  auditEventResultSchema,
  auditPageResultSchema,
  capabilityResultSchema,
  dashboardResultSchema,
  identityResultSchema,
  memberPageResultSchema,
  organizationPageResultSchema,
  organizationResultSchema,
  permissionListResultSchema,
  rolePageResultSchema,
  roleResultSchema,
  sessionPageResultSchema,
  sessionResultSchema,
  sitePageResultSchema,
  siteResultSchema,
  userPageResultSchema,
  userResultSchema,
} from './responses'

describe('method response schemas', () => {
  it('parse every provisional client response with an exact envelope', async () => {
    const client = new FixtureAdminDataClient()
    const platform = { type: 'platform' } as const
    const organization = { type: 'organization', id: 'org_aurora' } as const
    const cases = [
      [identityResultSchema, client.getCurrentIdentity()],
      [capabilityResultSchema, client.getCapabilities(platform)],
      [dashboardResultSchema, client.getDashboard(platform)],
      [userPageResultSchema, client.listUsers()],
      [userResultSchema, client.getUser('usr_ada')],
      [organizationPageResultSchema, client.listOrganizations()],
      [organizationResultSchema, client.getOrganization('org_aurora')],
      [sitePageResultSchema, client.listSites()],
      [siteResultSchema, client.getSite('site_aurora_us')],
      [memberPageResultSchema, client.listMembers({ scope: organization })],
      [rolePageResultSchema, client.listRoles({ scope: organization })],
      [roleResultSchema, client.getRole('role_org_admin')],
      [permissionListResultSchema, client.listPermissions(organization)],
      [sessionPageResultSchema, client.listSessions()],
      [sessionResultSchema, client.getSession('ses_ada_web')],
      [auditPageResultSchema, client.listAudit()],
      [auditEventResultSchema, client.getAuditEvent('evt_1003')],
      [
        accessCheckResultSchema,
        client.checkAccess({
          subjectId: 'usr_ada',
          scope: platform,
          resource: 'users',
          action: 'read',
        }),
      ],
    ] as const

    for (const [schema, pending] of cases) {
      expect(schema.safeParse(await pending).success).toBe(true)
    }
  })

  it('rejects widened envelopes and nested entities', async () => {
    const client = new FixtureAdminDataClient()
    const result = await client.getUser('usr_ada')

    expect(userResultSchema.safeParse({ ...result, debug: true }).success).toBe(
      false
    )
    expect(
      userResultSchema.safeParse({
        ...result,
        data: { ...result.data, accessToken: 'hidden' },
      }).success
    ).toBe(false)
  })
})
