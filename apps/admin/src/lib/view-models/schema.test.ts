import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { ADMIN_FIXTURE_SCHEMA_VERSION } from './common'
import {
  adminErrorSchema,
  dataResultSchema,
  entityIdSchema,
  instantSchema,
  isAdminError,
  pageSchema,
  parseAdminError,
  scopeSchema,
  sortSchema,
} from './schema'

describe('common view-model schemas', () => {
  it.each([
    { type: 'platform' },
    { type: 'organization', id: 'org_aurora' },
    { type: 'site', id: 'site_aurora_us' },
  ])('accepts the exact scope variants', (scope) => {
    expect(scopeSchema.parse(scope)).toEqual(scope)
  })

  it.each([
    { type: 'platform', id: 'unexpected' },
    { type: 'organization' },
    { type: 'site', id: '' },
    { type: 'workspace', id: 'workspace_1' },
    { type: 'platform', extra: true },
  ])('rejects an invalid or widened scope: %j', (scope) => {
    expect(scopeSchema.safeParse(scope).success).toBe(false)
  })

  it('accepts opaque IDs and valid ISO instants without inventing UUID rules', () => {
    expect(entityIdSchema.parse('usr_ada')).toBe('usr_ada')
    expect(instantSchema.parse('2026-08-18T14:35:42.123456789Z')).toBe(
      '2026-08-18T14:35:42.123456789Z'
    )
    expect(instantSchema.parse('2026-08-18T10:35:42-04:00')).toBe(
      '2026-08-18T10:35:42-04:00'
    )
  })

  it('keeps identifiers opaque instead of inventing a backend format', () => {
    expect(entityIdSchema.parse('id with spaces/and/slashes')).toBe(
      'id with spaces/and/slashes'
    )
    expect(entityIdSchema.safeParse('').success).toBe(false)
    expect(entityIdSchema.safeParse('x'.repeat(4097)).success).toBe(false)
    expect(entityIdSchema.safeParse('id\nforged').success).toBe(false)
    expect(entityIdSchema.safeParse('id\u0000forged').success).toBe(false)
  })

  it.each([
    '',
    '2026-08-18',
    '2026-02-30T00:00:00Z',
    '2026-08-18T14:35:42',
    'not-a-date',
  ])('%j is not an instant', (instant) => {
    expect(instantSchema.safeParse(instant).success).toBe(false)
  })

  it('validates strict sort objects and direction enums', () => {
    expect(
      sortSchema.parse({ field: 'displayName', direction: 'asc' })
    ).toEqual({ field: 'displayName', direction: 'asc' })
    expect(
      sortSchema.safeParse({ field: 'name', direction: 'up' }).success
    ).toBe(false)
    expect(
      sortSchema.safeParse({ field: 'name', direction: 'asc', extra: true })
        .success
    ).toBe(false)
  })

  it('builds a strict page schema from its item schema', () => {
    const schema = pageSchema(z.object({ id: entityIdSchema }).strict())
    const page = {
      items: [{ id: 'usr_ada' }],
      nextPageToken: 'opaque-token',
      totalCount: 1,
    }

    expect(schema.parse(page)).toEqual(page)
    expect(schema.safeParse({ ...page, extra: true }).success).toBe(false)
    expect(schema.safeParse({ ...page, totalCount: -1 }).success).toBe(false)
    expect(schema.safeParse({ ...page, totalCount: 1.5 }).success).toBe(false)
    expect(schema.safeParse({ ...page, nextPageToken: null }).success).toBe(
      false
    )
    expect(
      schema.safeParse({
        items: Array.from({ length: 101 }, () => page.items[0]),
      }).success
    ).toBe(false)
    expect(
      schema.safeParse({ items: [], nextPageToken: 'x'.repeat(4_097) }).success
    ).toBe(false)
  })

  it('builds a strict versioned data-result envelope', () => {
    const schema = dataResultSchema(z.object({ id: entityIdSchema }).strict())
    const result = {
      data: { id: 'usr_ada' },
      requestId: 'req_fixture_0001',
      schemaVersion: ADMIN_FIXTURE_SCHEMA_VERSION,
    }

    expect(schema.parse(result)).toEqual(result)
    expect(
      schema.safeParse({ ...result, schemaVersion: 'future.v1' }).success
    ).toBe(false)
    expect(schema.safeParse({ ...result, debug: true }).success).toBe(false)
  })

  it('validates the complete strict AdminError envelope', () => {
    const error = {
      kind: 'admin-data-error',
      code: 'INVALID_ARGUMENT',
      businessCode: 'INVALID_PAGE_SIZE',
      fieldViolations: [{ path: 'pageSize', code: 'OUT_OF_RANGE' }],
      requestId: 'req_fixture_0001',
      retryAfterMs: 250,
      safeMessage: 'Choose a supported page size.',
    } as const

    expect(adminErrorSchema.parse(error)).toEqual(error)
    expect(
      adminErrorSchema.safeParse({ ...error, code: 'INTERNAL' }).success
    ).toBe(false)
    expect(
      adminErrorSchema.safeParse({ ...error, retryAfterMs: -1 }).success
    ).toBe(false)
    expect(
      adminErrorSchema.safeParse({ ...error, cause: 'secret' }).success
    ).toBe(false)
    expect(
      adminErrorSchema.safeParse({
        ...error,
        fieldViolations: Array.from(
          { length: 101 },
          () => error.fieldViolations[0]
        ),
      }).success
    ).toBe(false)
    expect(
      adminErrorSchema.safeParse({
        ...error,
        safeMessage: 'x'.repeat(2_001),
      }).success
    ).toBe(false)
  })

  it('keeps optional fields optional but does not silently accept null', () => {
    expect(
      adminErrorSchema.parse({
        kind: 'admin-data-error',
        code: 'UNKNOWN',
        fieldViolations: [],
        requestId: 'req_unknown',
      })
    ).toEqual({
      kind: 'admin-data-error',
      code: 'UNKNOWN',
      fieldViolations: [],
      requestId: 'req_unknown',
    })
    expect(
      adminErrorSchema.safeParse({
        kind: 'admin-data-error',
        code: 'UNKNOWN',
        businessCode: null,
        fieldViolations: [],
        requestId: 'req_unknown',
      }).success
    ).toBe(false)
  })

  it('does not accept a kind-only object as an AdminError', () => {
    expect(isAdminError({ kind: 'admin-data-error' })).toBe(false)
    expect(
      isAdminError({
        kind: 'admin-data-error',
        code: 'UNKNOWN',
        fieldViolations: [],
        requestId: 'req_unknown',
      })
    ).toBe(true)
    expect(
      isAdminError({
        kind: 'admin-data-error',
        code: 'UNAUTHENTICATED',
        fieldViolations: [],
        requestId: 'opaque request/id',
        futureField: true,
        safeMessage: 'x'.repeat(10_000),
      })
    ).toBe(true)
  })

  it('fails closed for hostile runtime objects', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(() => isAdminError(proxy)).not.toThrow()
    expect(isAdminError(proxy)).toBe(false)
  })

  it('keeps the control code while sanitizing an unsafe request id', () => {
    expect(
      parseAdminError({
        kind: 'admin-data-error',
        code: 'UNAUTHENTICATED',
        fieldViolations: [],
        requestId: 'req\nforged',
      })
    ).toMatchObject({
      code: 'UNAUTHENTICATED',
      requestId: 'invalid-request-id',
    })
  })
})
