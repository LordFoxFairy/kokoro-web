import { describe, expect, it } from 'vitest'
import { FixtureAdminDataClient } from '../fixtures/client'
import {
  accessCheckInputSchema,
  auditPageRequestSchema,
  scopePageRequestSchema,
  sessionPageRequestSchema,
  statusPageRequestSchema,
} from './requests'

describe('client request schemas', () => {
  it('parses a strict status page request', () => {
    const value = {
      query: 'ada',
      pageSize: 50,
      pageToken: 'opaque+/=',
      sort: { field: 'updatedAt', direction: 'desc' },
      statuses: ['active', 'deleted'],
    }
    expect(statusPageRequestSchema.parse(value)).toEqual(value)
    expect(
      statusPageRequestSchema.safeParse({ ...value, includeDeleted: true })
        .success
    ).toBe(false)
  })

  it('requires valid page bounds and exact enums', () => {
    for (const pageSize of [0, 101, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(statusPageRequestSchema.safeParse({ pageSize }).success).toBe(
        false
      )
    }
    expect(
      statusPageRequestSchema.safeParse({ statuses: ['pending'] }).success
    ).toBe(false)
    expect(
      sessionPageRequestSchema.safeParse({ statuses: ['disabled'] }).success
    ).toBe(false)
  })

  it('requires a complete strict scope request', () => {
    expect(
      scopePageRequestSchema.parse({
        scope: { type: 'site', id: 'site_aurora' },
        pageSize: 20,
      })
    ).toEqual({ scope: { type: 'site', id: 'site_aurora' }, pageSize: 20 })
    expect(
      scopePageRequestSchema.safeParse({ scope: { type: 'platform', id: 'x' } })
        .success
    ).toBe(false)
  })

  it('parses session and audit filters without widening fields', () => {
    expect(
      sessionPageRequestSchema.parse({
        userId: 'usr_ada',
        statuses: ['active', 'revoked'],
      })
    ).toEqual({ userId: 'usr_ada', statuses: ['active', 'revoked'] })

    const audit = {
      actorId: 'usr_ada',
      targetId: 'usr_ben',
      requestId: 'req_source',
      outcomes: ['denied', 'failure'],
      scope: { type: 'platform' },
    }
    expect(auditPageRequestSchema.parse(audit)).toEqual(audit)
    expect(
      auditPageRequestSchema.safeParse({ ...audit, rawSql: 'select 1' }).success
    ).toBe(false)
  })

  it('strictly parses the access diagnostic request', () => {
    const value = {
      subjectId: 'opaque subject/1',
      scope: { type: 'platform' },
      resource: 'users',
      action: 'read',
    }
    expect(accessCheckInputSchema.parse(value)).toEqual(value)
    expect(
      accessCheckInputSchema.safeParse({ ...value, allowed: true }).success
    ).toBe(false)
    expect(
      accessCheckInputSchema.safeParse({ ...value, scope: { type: 'site' } })
        .success
    ).toBe(false)
  })

  it('enforces access diagnostics at the actual fixture boundary', async () => {
    const client = new FixtureAdminDataClient()
    const pending = Reflect.apply(client.checkAccess, client, [
      {
        subjectId: 'usr_ada',
        scope: { type: 'platform' },
        resource: 'users',
        action: 'read',
        allowed: true,
      },
    ])

    await expect(pending).rejects.toMatchObject({
      kind: 'admin-data-error',
      code: 'INVALID_ARGUMENT',
      businessCode: 'INVALID_REQUEST',
    })
  })

  it('maps hostile request objects to stable AdminError', async () => {
    const client = new FixtureAdminDataClient()
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    const pending = Reflect.apply(client.listUsers, client, [proxy])

    await expect(pending).rejects.toMatchObject({
      kind: 'admin-data-error',
      code: 'INVALID_ARGUMENT',
      businessCode: 'INVALID_REQUEST',
    })
  })

  it('sanitizes hostile caller request ids on success and failure', async () => {
    const successClient = new FixtureAdminDataClient()
    await expect(
      successClient.getCurrentIdentity({ requestId: 'req\nforged' })
    ).resolves.toMatchObject({ requestId: 'req_fixture_0001' })

    const failureClient = new FixtureAdminDataClient()
    await expect(
      failureClient.listUsers({ pageSize: 0 }, { requestId: 'req\u0000forged' })
    ).rejects.toMatchObject({
      kind: 'admin-data-error',
      code: 'INVALID_ARGUMENT',
      requestId: 'req_fixture_0001',
    })
  })
})
