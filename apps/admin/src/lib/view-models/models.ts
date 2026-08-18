import type { Capability, EntityId, Instant, Scope } from './common'

export type EntityStatus = 'active' | 'suspended' | 'deleted' | 'unknown'

export type DashboardMetric = {
  readonly key:
    'users' | 'organizations' | 'sites' | 'activeSessions' | 'securityEvents'
  readonly value: number
  readonly windowLabel: string
  readonly targetPath: string
}

export type DashboardSummary = {
  readonly generatedAt: Instant
  readonly metrics: readonly DashboardMetric[]
  readonly recentAudit: readonly AuditEvent[]
}

export type User = {
  readonly id: EntityId
  readonly displayName: string
  readonly email: string
  readonly status: EntityStatus
  readonly createdAt: Instant
  readonly updatedAt: Instant
}

export type Organization = {
  readonly id: EntityId
  readonly name: string
  readonly slug: string
  readonly status: EntityStatus
  readonly createdAt: Instant
  readonly updatedAt: Instant
}

export type Site = {
  readonly id: EntityId
  readonly organizationId: EntityId
  readonly name: string
  readonly slug: string
  readonly status: EntityStatus
  readonly createdAt: Instant
  readonly updatedAt: Instant
}

export type Member = {
  readonly id: EntityId
  readonly userId: EntityId
  readonly scope: Scope
  readonly roleIds: readonly EntityId[]
  readonly status: EntityStatus
  readonly joinedAt: Instant
}

export type Permission = {
  readonly key: string
  readonly group: string
  readonly label: string
  readonly description?: string
}

export type Role = {
  readonly id: EntityId
  readonly scope: Scope
  readonly name: string
  readonly description?: string
  readonly status: EntityStatus
  readonly builtIn: boolean
  readonly memberCount: number
  readonly permissionKeys: readonly string[]
  readonly updatedAt: Instant
}

export type SessionStatus = 'active' | 'expired' | 'revoked' | 'unknown'

export type Session = {
  readonly id: EntityId
  readonly userId: EntityId
  readonly status: SessionStatus
  readonly clientLabel: string
  readonly ipAddress?: string
  readonly createdAt: Instant
  readonly lastActiveAt: Instant
  readonly expiresAt: Instant
  readonly revokedAt?: Instant
}

export type AuditOutcome = 'success' | 'denied' | 'failure' | 'unknown'

export type AuditEvent = {
  readonly id: EntityId
  readonly occurredAt: Instant
  readonly actorId?: EntityId
  readonly action: string
  readonly targetType: string
  readonly targetId?: EntityId
  readonly scope?: Scope
  readonly outcome: AuditOutcome
  readonly commandId?: string
  readonly requestId: string
  readonly attributes: Readonly<Record<string, string>>
}

export type AccessCheckInput = {
  readonly subjectId: EntityId
  readonly scope: Scope
  readonly resource: string
  readonly action: string
}

export type AccessCheck = AccessCheckInput & {
  readonly allowed: boolean
  readonly checkedAt: Instant
  readonly reasonCode: string
  readonly evidence: readonly string[]
}

export type CurrentIdentity = {
  readonly id: EntityId
  readonly displayName: string
  readonly email: string
  readonly capabilities: readonly Capability[]
}
