import type {
  AccessCheck,
  AuditEvent,
  Capability,
  Member,
  Organization,
  Permission,
  Role,
  Session,
  Site,
  User,
} from '../view-models'

export const FIXTURE_NOW = '2026-08-18T14:00:00.000Z'

export const fixtureAccessChecks: readonly AccessCheck[] = [
  {
    subjectId: 'usr_ada',
    scope: { type: 'platform' },
    resource: 'users',
    action: 'read',
    allowed: true,
    checkedAt: FIXTURE_NOW,
    reasonCode: 'FIXTURE_POLICY_ALLOW',
    evidence: ['policy:platform-user-reader'],
  },
  {
    subjectId: 'usr_ada',
    scope: { type: 'organization', id: 'org_aurora' },
    resource: 'users',
    action: 'read',
    allowed: false,
    checkedAt: FIXTURE_NOW,
    reasonCode: 'FIXTURE_POLICY_DENY',
    evidence: ['policy:organization-user-boundary'],
  },
]

export const fixtureCapabilities: readonly Capability[] = [
  { key: 'dashboard.read', scope: { type: 'platform' } },
  { key: 'users.read', scope: { type: 'platform' } },
  { key: 'organizations.read', scope: { type: 'platform' } },
  { key: 'sites.read', scope: { type: 'platform' } },
  { key: 'roles.read', scope: { type: 'organization', id: 'org_aurora' } },
  { key: 'sessions.read', scope: { type: 'platform' } },
  { key: 'audit.read', scope: { type: 'platform' } },
  { key: 'access.check', scope: { type: 'platform' } },
]

export const fixtureUsers: readonly User[] = [
  {
    id: 'usr_ada',
    displayName: 'Ada Chen',
    email: 'ada@example.test',
    status: 'active',
    createdAt: '2026-01-04T10:15:00.000Z',
    updatedAt: '2026-08-18T11:20:00.000Z',
  },
  {
    id: 'usr_mina',
    displayName: 'Mina Patel',
    email: 'mina@example.test',
    status: 'active',
    createdAt: '2026-02-12T09:30:00.000Z',
    updatedAt: '2026-08-17T16:40:00.000Z',
  },
  {
    id: 'usr_noah',
    displayName: 'Noah Williams',
    email: 'noah@example.test',
    status: 'suspended',
    createdAt: '2026-03-21T13:00:00.000Z',
    updatedAt: '2026-08-15T08:05:00.000Z',
  },
  {
    id: 'usr_yuki',
    displayName: 'Yuki Sato',
    email: 'yuki@example.test',
    status: 'deleted',
    createdAt: '2026-04-08T18:25:00.000Z',
    updatedAt: '2026-08-12T12:10:00.000Z',
  },
]

export const fixtureOrganizations: readonly Organization[] = [
  {
    id: 'org_aurora',
    name: 'Aurora Labs',
    slug: 'aurora-labs',
    status: 'active',
    createdAt: '2025-11-02T09:00:00.000Z',
    updatedAt: '2026-08-16T14:30:00.000Z',
  },
  {
    id: 'org_northstar',
    name: 'Northstar Studio',
    slug: 'northstar-studio',
    status: 'active',
    createdAt: '2026-01-19T11:45:00.000Z',
    updatedAt: '2026-08-14T10:10:00.000Z',
  },
  {
    id: 'org_archive',
    name: 'Archive Works',
    slug: 'archive-works',
    status: 'deleted',
    createdAt: '2025-12-03T08:20:00.000Z',
    updatedAt: '2026-08-10T19:00:00.000Z',
  },
]

export const fixtureSites: readonly Site[] = [
  {
    id: 'site_aurora_us',
    organizationId: 'org_aurora',
    name: 'Aurora US',
    slug: 'aurora-us',
    status: 'active',
    createdAt: '2026-01-11T12:00:00.000Z',
    updatedAt: '2026-08-18T09:20:00.000Z',
  },
  {
    id: 'site_aurora_eu',
    organizationId: 'org_aurora',
    name: 'Aurora EU',
    slug: 'aurora-eu',
    status: 'suspended',
    createdAt: '2026-02-02T12:00:00.000Z',
    updatedAt: '2026-08-13T07:15:00.000Z',
  },
  {
    id: 'site_northstar',
    organizationId: 'org_northstar',
    name: 'Northstar Main',
    slug: 'northstar-main',
    status: 'active',
    createdAt: '2026-03-07T15:10:00.000Z',
    updatedAt: '2026-08-17T17:25:00.000Z',
  },
]

export const fixtureMembers: readonly Member[] = [
  {
    id: 'mem_ada_aurora',
    userId: 'usr_ada',
    scope: { type: 'organization', id: 'org_aurora' },
    roleIds: ['role_org_admin'],
    status: 'active',
    joinedAt: '2026-01-04T10:20:00.000Z',
  },
  {
    id: 'mem_mina_aurora',
    userId: 'usr_mina',
    scope: { type: 'organization', id: 'org_aurora' },
    roleIds: ['role_org_auditor'],
    status: 'active',
    joinedAt: '2026-02-15T09:10:00.000Z',
  },
  {
    id: 'mem_ada_site',
    userId: 'usr_ada',
    scope: { type: 'site', id: 'site_aurora_us' },
    roleIds: ['role_site_manager'],
    status: 'active',
    joinedAt: '2026-01-11T12:30:00.000Z',
  },
]

export const fixturePermissions: readonly Permission[] = [
  { key: 'members.read', group: 'Members', label: 'View members' },
  { key: 'members.manage', group: 'Members', label: 'Manage members' },
  { key: 'roles.read', group: 'Access', label: 'View roles' },
  { key: 'roles.manage', group: 'Access', label: 'Manage roles' },
  { key: 'audit.read', group: 'Security', label: 'View audit events' },
]

export const fixtureRoles: readonly Role[] = [
  {
    id: 'role_org_admin',
    scope: { type: 'organization', id: 'org_aurora' },
    name: 'Organization administrator',
    status: 'active',
    builtIn: true,
    memberCount: 1,
    permissionKeys: [
      'members.read',
      'members.manage',
      'roles.read',
      'roles.manage',
      'audit.read',
    ],
    updatedAt: '2026-08-16T10:00:00.000Z',
  },
  {
    id: 'role_org_auditor',
    scope: { type: 'organization', id: 'org_aurora' },
    name: 'Auditor',
    status: 'active',
    builtIn: false,
    memberCount: 1,
    permissionKeys: ['members.read', 'roles.read', 'audit.read'],
    updatedAt: '2026-08-17T10:00:00.000Z',
  },
  {
    id: 'role_site_manager',
    scope: { type: 'site', id: 'site_aurora_us' },
    name: 'Site manager',
    status: 'active',
    builtIn: true,
    memberCount: 1,
    permissionKeys: ['members.read', 'members.manage', 'roles.read'],
    updatedAt: '2026-08-15T10:00:00.000Z',
  },
]

export const fixtureSessions: readonly Session[] = [
  {
    id: 'ses_ada_web',
    userId: 'usr_ada',
    status: 'active',
    clientLabel: 'Chrome on macOS',
    ipAddress: '192.0.2.10',
    createdAt: '2026-08-18T08:00:00.000Z',
    lastActiveAt: '2026-08-18T13:55:00.000Z',
    expiresAt: '2026-08-25T08:00:00.000Z',
  },
  {
    id: 'ses_mina_mobile',
    userId: 'usr_mina',
    status: 'active',
    clientLabel: 'Safari on iOS',
    ipAddress: '198.51.100.24',
    createdAt: '2026-08-17T12:00:00.000Z',
    lastActiveAt: '2026-08-18T12:45:00.000Z',
    expiresAt: '2026-08-24T12:00:00.000Z',
  },
  {
    id: 'ses_noah_old',
    userId: 'usr_noah',
    status: 'revoked',
    clientLabel: 'Firefox on Linux',
    createdAt: '2026-08-10T10:00:00.000Z',
    lastActiveAt: '2026-08-14T06:30:00.000Z',
    expiresAt: '2026-08-17T10:00:00.000Z',
    revokedAt: '2026-08-15T08:05:00.000Z',
  },
]

export const fixtureAudit: readonly AuditEvent[] = [
  {
    id: 'evt_1003',
    occurredAt: '2026-08-18T13:40:00.000Z',
    actorId: 'usr_ada',
    action: 'session.list',
    targetType: 'session',
    scope: { type: 'platform' },
    outcome: 'success',
    requestId: 'req_fixture_1003',
    attributes: { resultCount: '3' },
  },
  {
    id: 'evt_1002',
    occurredAt: '2026-08-18T11:20:00.000Z',
    actorId: 'usr_ada',
    action: 'user.update',
    targetType: 'user',
    targetId: 'usr_ada',
    scope: { type: 'platform' },
    outcome: 'success',
    commandId: 'cmd_fixture_1002',
    requestId: 'req_fixture_1002',
    attributes: { changedFields: 'displayName' },
  },
  {
    id: 'evt_1001',
    occurredAt: '2026-08-17T16:40:00.000Z',
    actorId: 'usr_mina',
    action: 'role.read',
    targetType: 'role',
    targetId: 'role_org_auditor',
    scope: { type: 'organization', id: 'org_aurora' },
    outcome: 'success',
    requestId: 'req_fixture_1001',
    attributes: {},
  },
]
