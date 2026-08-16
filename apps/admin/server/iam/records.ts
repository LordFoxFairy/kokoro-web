import "server-only";

import { timestampDate } from "@bufbuild/protobuf/wkt";

import type {
  OrganizationRecord,
  SecurityEventRecord,
  SessionSummaryRecord,
  UserRecord,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";

export type AdminUser = Readonly<{
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: Date | null;
  platformRole: "user" | "admin";
  status: "active" | "suspended" | "deleted";
  version: bigint;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminOrganization = Readonly<{
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  version: bigint;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminSession = Readonly<{
  id: string;
  userId: string;
  expiresAt: Date;
  activeOrganizationId: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminSecurityEvent = Readonly<{
  id: string;
  kind: string;
  actorUserId: string | null;
  targetUserId: string | null;
  organizationId: string | null;
  sessionId: string | null;
  requestId: string;
  commandId: string | null;
  createdAt: Date;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;
const userStatuses = new Set(["active", "suspended", "deleted"]);
const organizationStatuses = new Set(["active", "suspended", "deleted"]);

type RecordName = "UserRecord" | "OrganizationRecord" | "SessionSummaryRecord" | "SecurityEventRecord";

function invalid(name: RecordName): never {
  throw new Error(`invalid IAM ${name}`);
}

function date(value: Parameters<typeof timestampDate>[0] | undefined, name: RecordName): Date {
  if (value === undefined) return invalid(name);
  try {
    const result = timestampDate(value);
    if (!Number.isFinite(result.getTime())) return invalid(name);
    return result;
  } catch {
    return invalid(name);
  }
}

export function userFromRecord(record: UserRecord | undefined): AdminUser {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !emailPattern.test(record.email)
    || record.name.trim().length < 1
    || record.name.length > 160
    || (record.image !== undefined && record.image.length > 4_096)
    || (record.platformRole !== "user" && record.platformRole !== "admin")
    || !userStatuses.has(record.status)
    || record.version < BigInt(0)
  ) {
    return invalid("UserRecord");
  }
  return Object.freeze({
    id: record.id,
    email: record.email,
    name: record.name,
    image: record.image ?? null,
    emailVerified: record.emailVerified === undefined ? null : date(record.emailVerified, "UserRecord"),
    platformRole: record.platformRole,
    status: record.status as AdminUser["status"],
    version: record.version,
    deletedAt: record.deletedAt === undefined ? null : date(record.deletedAt, "UserRecord"),
    createdAt: date(record.createdAt, "UserRecord"),
    updatedAt: date(record.updatedAt, "UserRecord"),
  });
}

export function organizationFromRecord(record: OrganizationRecord | undefined): AdminOrganization {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !slugPattern.test(record.slug)
    || record.name.trim().length < 1
    || record.name.length > 160
    || !organizationStatuses.has(record.status)
    || record.version < BigInt(0)
  ) {
    return invalid("OrganizationRecord");
  }
  return Object.freeze({
    id: record.id,
    slug: record.slug,
    name: record.name,
    status: record.status as AdminOrganization["status"],
    version: record.version,
    deletedAt: record.deletedAt === undefined ? null : date(record.deletedAt, "OrganizationRecord"),
    createdAt: date(record.createdAt, "OrganizationRecord"),
    updatedAt: date(record.updatedAt, "OrganizationRecord"),
  });
}

export function sessionFromRecord(record: SessionSummaryRecord | undefined): AdminSession {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !uuidPattern.test(record.userId)
    || (record.activeOrganizationId !== undefined && !uuidPattern.test(record.activeOrganizationId))
  ) {
    return invalid("SessionSummaryRecord");
  }
  return Object.freeze({
    id: record.id,
    userId: record.userId,
    expiresAt: date(record.expires, "SessionSummaryRecord"),
    activeOrganizationId: record.activeOrganizationId ?? null,
    revokedAt: record.revokedAt === undefined ? null : date(record.revokedAt, "SessionSummaryRecord"),
    createdAt: date(record.createdAt, "SessionSummaryRecord"),
    updatedAt: date(record.updatedAt, "SessionSummaryRecord"),
  });
}

export function securityEventFromRecord(record: SecurityEventRecord | undefined): AdminSecurityEvent {
  const optionalIds = [
    record?.actorUserId,
    record?.targetUserId,
    record?.organizationId,
    record?.sessionId,
    record?.commandId,
  ];
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || record.kind.trim().length < 1
    || record.kind.length > 96
    || !uuidPattern.test(record.requestId)
    || optionalIds.some((value) => value !== undefined && !uuidPattern.test(value))
    || record.metadataJson.length > 16_384
  ) {
    return invalid("SecurityEventRecord");
  }
  return Object.freeze({
    id: record.id,
    kind: record.kind,
    actorUserId: record.actorUserId ?? null,
    targetUserId: record.targetUserId ?? null,
    organizationId: record.organizationId ?? null,
    sessionId: record.sessionId ?? null,
    requestId: record.requestId,
    commandId: record.commandId ?? null,
    createdAt: date(record.createdAt, "SecurityEventRecord"),
  });
}
