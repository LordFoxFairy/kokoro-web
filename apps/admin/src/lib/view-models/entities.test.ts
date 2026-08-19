import { describe, expect, it } from 'vitest'
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

const instant = '2026-08-18T14:30:00.000Z'
const platformScope = { type: 'platform' } as const
const capability = { key: 'users.read', scope: platformScope }

const auditEvent = {
  id: 'audit-1',
  occurredAt: instant,
  actorId: 'user-1',
  action: 'user.read',
  targetType: 'user',
  targetId: 'user-2',
  scope: platformScope,
  outcome: 'success',
  commandId: 'command-1',
  requestId: 'request-1',
  attributes: { source: 'admin' },
} as const

const validCases = [
  [
    'user',
    userSchema,
    {
      id: 'user-1',
      displayName: 'Admin',
      email: 'admin@example.test',
      status: 'active',
      createdAt: instant,
      updatedAt: instant,
    },
  ],
  [
    'organization',
    organizationSchema,
    {
      id: 'organization-1',
      name: 'Kokoro',
      slug: 'kokoro',
      status: 'active',
      createdAt: instant,
      updatedAt: instant,
    },
  ],
  [
    'site',
    siteSchema,
    {
      id: 'site-1',
      organizationId: 'organization-1',
      name: 'Main',
      slug: 'main',
      status: 'active',
      createdAt: instant,
      updatedAt: instant,
    },
  ],
  [
    'member',
    memberSchema,
    {
      id: 'member-1',
      userId: 'user-1',
      scope: { type: 'site', id: 'site-1' },
      roleIds: ['role-1'],
      status: 'active',
      joinedAt: instant,
    },
  ],
  [
    'permission',
    permissionSchema,
    {
      key: 'users.read',
      group: 'users',
      label: 'Read users',
      description: 'View user records',
    },
  ],
  [
    'role',
    roleSchema,
    {
      id: 'role-1',
      scope: { type: 'organization', id: 'organization-1' },
      name: 'Reader',
      description: 'Read-only access',
      status: 'active',
      builtIn: false,
      memberCount: 3,
      permissionKeys: ['users.read'],
      updatedAt: instant,
    },
  ],
  [
    'session',
    sessionSchema,
    {
      id: 'session-1',
      userId: 'user-1',
      status: 'revoked',
      clientLabel: 'Chrome',
      ipAddress: '127.0.0.1',
      createdAt: instant,
      lastActiveAt: instant,
      expiresAt: instant,
      revokedAt: instant,
    },
  ],
  ['audit event', auditEventSchema, auditEvent],
  [
    'access check',
    accessCheckSchema,
    {
      subjectId: 'user-1',
      scope: platformScope,
      resource: 'users',
      action: 'read',
      allowed: true,
      checkedAt: instant,
      reasonCode: 'ROLE_PERMISSION',
      evidence: ['role-1'],
    },
  ],
  [
    'dashboard summary',
    dashboardSummarySchema,
    {
      generatedAt: instant,
      sections: { metrics: 'ready', recentAudit: 'ready' },
      metrics: [
        {
          key: 'users',
          value: 12,
          windowLabel: 'Total',
          targetPath: '/users',
        },
      ],
      recentAudit: [auditEvent],
    },
  ],
  [
    'current identity',
    currentIdentitySchema,
    {
      id: 'user-1',
      displayName: 'Admin',
      email: 'admin@example.test',
      capabilities: [capability],
    },
  ],
  [
    'capability projection',
    capabilityProjectionSchema,
    {
      schemaVersion: 'kokoro.admin.fixture.v2',
      subjectId: 'user-1',
      capabilities: [capability],
      projectedAt: instant,
    },
  ],
] as const

describe('entity view-model schemas', () => {
  it.each(validCases)('parses a valid %s', (_name, schema, value) => {
    expect(schema.safeParse(value).success).toBe(true)
  })

  it.each(validCases)(
    'rejects unknown fields on %s',
    (_name, schema, value) => {
      expect(schema.safeParse({ ...value, unexpected: true }).success).toBe(
        false
      )
    }
  )

  it('rejects unknown fields in nested scope, capability, section, metric, and audit objects', () => {
    expect(
      memberSchema.safeParse({
        ...validCases[3][2],
        scope: { type: 'site', id: 'site-1', unexpected: true },
      }).success
    ).toBe(false)
    expect(
      currentIdentitySchema.safeParse({
        ...validCases[10][2],
        capabilities: [{ ...capability, unexpected: true }],
      }).success
    ).toBe(false)
    expect(
      dashboardSummarySchema.safeParse({
        ...validCases[9][2],
        sections: {
          ...validCases[9][2].sections,
          unexpected: true,
        },
      }).success
    ).toBe(false)
    expect(
      dashboardSummarySchema.safeParse({
        ...validCases[9][2],
        metrics: [{ ...validCases[9][2].metrics[0], unexpected: true }],
      }).success
    ).toBe(false)
    expect(
      dashboardSummarySchema.safeParse({
        ...validCases[9][2],
        recentAudit: [{ ...auditEvent, unexpected: true }],
      }).success
    ).toBe(false)
  })

  it('requires offset-aware ISO timestamps', () => {
    expect(
      userSchema.safeParse({ ...validCases[0][2], createdAt: '2026-08-18' })
        .success
    ).toBe(false)
    expect(
      sessionSchema.safeParse({
        ...validCases[6][2],
        expiresAt: 'August 18, 2026',
      }).success
    ).toBe(false)
  })

  it('rejects values outside contract enums', () => {
    expect(
      userSchema.safeParse({ ...validCases[0][2], status: 'pending' }).success
    ).toBe(false)
    expect(
      sessionSchema.safeParse({ ...validCases[6][2], status: 'pending' })
        .success
    ).toBe(false)
    expect(
      auditEventSchema.safeParse({ ...auditEvent, outcome: 'pending' }).success
    ).toBe(false)
  })

  it('requires string arrays and string-valued audit attributes', () => {
    expect(
      roleSchema.safeParse({
        ...validCases[5][2],
        permissionKeys: ['users.read', 42],
      }).success
    ).toBe(false)
    expect(
      auditEventSchema.safeParse({
        ...auditEvent,
        attributes: { attempts: 2 },
      }).success
    ).toBe(false)
  })

  it('requires the exact capability projection schema version', () => {
    expect(
      capabilityProjectionSchema.safeParse({
        ...validCases[11][2],
        schemaVersion: 'kokoro.admin.fixture.v1',
      }).success
    ).toBe(false)
  })

  it('rejects unsafe or oversized audit attributes', () => {
    for (const key of [
      'authorization',
      'accessToken',
      'refreshToken',
      'apiKey',
      'privateKey',
      'setCookie',
      'accesstoken',
      'REFRESHTOKEN',
      'privatekey',
      'APIKEY',
      'setcookie',
      'accesstokenvalue',
      'REFRESHTOKENRAW',
      'privatekeypem',
      'APIKEYVALUE',
      'setcookieheader',
      'tokenRawCount',
      'tokenValueUsage',
      'cookieHeaderConsent',
      'credentialValueType',
      'request.token',
      'private-key',
      'constructor',
      '__proto__',
    ]) {
      const attributes = JSON.parse(`{"${key}":"hidden"}`) as unknown
      expect(
        auditEventSchema.safeParse({ ...auditEvent, attributes }).success
      ).toBe(false)
    }

    expect(
      auditEventSchema.safeParse({
        ...auditEvent,
        attributes: Object.fromEntries(
          Array.from({ length: 33 }, (_, index) => [`key_${index}`, 'value'])
        ),
      }).success
    ).toBe(false)
  })

  it('keeps non-secret audit dimensions available', () => {
    for (const key of [
      'tokenCount',
      'accessTokenCount',
      'tokenizedText',
      'cookieConsent',
      'secretaryId',
      'credentialType',
    ]) {
      expect(
        auditEventSchema.safeParse({
          ...auditEvent,
          attributes: { [key]: 'visible' },
        }).success
      ).toBe(true)
    }
  })

  it('rejects negative counts and oversized collections', () => {
    expect(
      roleSchema.safeParse({ ...validCases[5][2], memberCount: -1 }).success
    ).toBe(false)
    expect(
      dashboardSummarySchema.safeParse({
        ...validCases[9][2],
        metrics: Array.from({ length: 17 }, () => validCases[9][2].metrics[0]),
      }).success
    ).toBe(false)
    expect(
      currentIdentitySchema.safeParse({
        ...validCases[10][2],
        capabilities: Array.from({ length: 10_001 }, () => capability),
      }).success
    ).toBe(false)
  })

  it('accepts only safe same-origin dashboard paths', () => {
    for (const targetPath of [
      '//evil.example/path',
      '/\\evil.example/path',
      '/users\nnext',
    ]) {
      expect(
        dashboardSummarySchema.safeParse({
          ...validCases[9][2],
          metrics: [{ ...validCases[9][2].metrics[0], targetPath }],
        }).success
      ).toBe(false)
    }
  })
})
