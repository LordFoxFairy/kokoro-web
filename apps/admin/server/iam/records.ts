import "server-only";

import { timestampDate } from "@bufbuild/protobuf/wkt";

import type {
  MemberRecord,
  OrganizationRecord,
  PermissionRecord,
  RoleRecord,
  SecurityEventRecord,
  SessionSummaryRecord,
  SiteMemberRecord,
  SiteRecord,
  UserRecord,
} from "../../generated/iam/proto/kokoro/iam/v1/types_pb";
import type {
  AuthorizeSiteResponse,
  AuthorizeResponse,
  InspectUserSiteAuthorizationResponse,
  InspectUserAuthorizationResponse,
} from "../../generated/iam/proto/kokoro/iam/v1/authorization_pb";
import {
  iamAuthorizationReasons,
  iamRoleKeys,
  type IamAuthorizationReason,
  type IamRoleKey,
} from "../../lib/iam-values";

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

export type AdminSite = Readonly<{
  id: string;
  code: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  version: bigint;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminRoleKey = IamRoleKey;

export type AdminMember = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  roleId: string;
  roleKey: AdminRoleKey;
  status: "active" | "suspended" | "deleted";
  version: bigint;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminSiteMember = Readonly<{
  id: string;
  siteId: string;
  userId: string;
  roleId: string;
  roleKey: AdminRoleKey;
  status: "active" | "suspended" | "deleted";
  version: bigint;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type AdminRole = Readonly<{
  id: string;
  organizationId: string;
  key: AdminRoleKey;
  name: string;
  description: string;
  builtIn: boolean;
  status: "active" | "deleted";
  version: bigint;
  permissionKeys: readonly string[];
}>;

export type AdminPermission = Readonly<{
  id: string;
  key: string;
  resource: string;
  action: string;
  description: string;
  status: "active" | "retired";
}>;

export type AdminAuthorizationReason = IamAuthorizationReason;

export type AdminAuthorizationDecision = Readonly<{
  allowed: boolean;
  reasonCode: AdminAuthorizationReason;
  userId: string;
  sessionId: string;
  organizationId: string;
  roleKeys: readonly AdminRoleKey[];
  authorizationVersion: bigint;
  evaluatedAt: Date;
}>;

export type AdminAuthorizationInspection = Readonly<{
  allowed: boolean;
  reasonCode: AdminAuthorizationReason;
  userId: string;
  organizationId: string;
  roleKeys: readonly AdminRoleKey[];
  authorizationVersion: bigint;
  evaluatedAt: Date;
}>;

export type AdminSiteAuthorizationDecision = Omit<AdminAuthorizationDecision, "organizationId"> & Readonly<{
  siteId: string;
}>;

export type AdminSiteAuthorizationInspection = Omit<AdminAuthorizationInspection, "organizationId"> & Readonly<{
  siteId: string;
}>;

export type AdminSession = Readonly<{
  id: string;
  userId: string;
  expiresAt: Date;
  activeOrganizationId: string | null;
  activeSiteId: string | null;
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
  siteId: string | null;
  sessionId: string | null;
  requestId: string;
  commandId: string | null;
  metadataJson: string | null;
  createdAt: Date;
}>;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u;
const roleKeyPattern = /^[a-z][a-z0-9_]{0,63}$/u;
const permissionKeyPattern = /^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/u;
const userStatuses = new Set(["active", "suspended", "deleted"]);
const organizationStatuses = new Set(["active", "suspended", "deleted"]);
const siteStatuses = new Set(["active", "suspended", "deleted"]);
const memberStatuses = new Set(["active", "suspended", "deleted"]);
const roleStatuses = new Set(["active", "deleted"]);
const permissionStatuses = new Set(["active", "retired"]);
const roleKeys = new Set<string>(iamRoleKeys);
const authorizationReasons = new Set<AdminAuthorizationReason>(iamAuthorizationReasons);

function isAdminRoleKey(value: string): value is AdminRoleKey {
  return roleKeys.has(value);
}

type RecordName =
  | "UserRecord"
  | "OrganizationRecord"
  | "SiteRecord"
  | "SiteMemberRecord"
  | "MemberRecord"
  | "RoleRecord"
  | "PermissionRecord"
  | "AuthorizeResponse"
  | "InspectUserAuthorizationResponse"
  | "AuthorizeSiteResponse"
  | "InspectUserSiteAuthorizationResponse"
  | "SessionSummaryRecord"
  | "SecurityEventRecord";

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

export function siteFromRecord(record: SiteRecord | undefined): AdminSite {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !slugPattern.test(record.code)
    || record.name.trim().length < 1
    || record.name.length > 160
    || !siteStatuses.has(record.status)
    || record.version < BigInt(0)
  ) return invalid("SiteRecord");
  return Object.freeze({
    id: record.id,
    code: record.code,
    name: record.name,
    status: record.status as AdminSite["status"],
    version: record.version,
    deletedAt: record.deletedAt === undefined ? null : date(record.deletedAt, "SiteRecord"),
    createdAt: date(record.createdAt, "SiteRecord"),
    updatedAt: date(record.updatedAt, "SiteRecord"),
  });
}

export function memberFromRecord(record: MemberRecord | undefined): AdminMember {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !uuidPattern.test(record.organizationId)
    || !uuidPattern.test(record.userId)
    || !uuidPattern.test(record.roleId)
    || !isAdminRoleKey(record.roleKey)
    || !memberStatuses.has(record.status)
    || record.version < BigInt(0)
  ) {
    return invalid("MemberRecord");
  }
  return Object.freeze({
    id: record.id,
    organizationId: record.organizationId,
    userId: record.userId,
    roleId: record.roleId,
    roleKey: record.roleKey as AdminRoleKey,
    status: record.status as AdminMember["status"],
    version: record.version,
    deletedAt: record.deletedAt === undefined ? null : date(record.deletedAt, "MemberRecord"),
    createdAt: date(record.createdAt, "MemberRecord"),
    updatedAt: date(record.updatedAt, "MemberRecord"),
  });
}

export function siteMemberFromRecord(record: SiteMemberRecord | undefined): AdminSiteMember {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !uuidPattern.test(record.siteId)
    || !uuidPattern.test(record.userId)
    || !uuidPattern.test(record.roleId)
    || !isAdminRoleKey(record.roleKey)
    || !memberStatuses.has(record.status)
    || record.version < BigInt(0)
  ) return invalid("SiteMemberRecord");
  return Object.freeze({
    id: record.id,
    siteId: record.siteId,
    userId: record.userId,
    roleId: record.roleId,
    roleKey: record.roleKey as AdminRoleKey,
    status: record.status as AdminSiteMember["status"],
    version: record.version,
    deletedAt: record.deletedAt === undefined ? null : date(record.deletedAt, "SiteMemberRecord"),
    createdAt: date(record.createdAt, "SiteMemberRecord"),
    updatedAt: date(record.updatedAt, "SiteMemberRecord"),
  });
}

export function roleFromRecord(record: RoleRecord | undefined): AdminRole {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !uuidPattern.test(record.organizationId)
    || !isAdminRoleKey(record.key)
    || record.name.trim().length < 1
    || record.name.length > 160
    || record.description.length > 1_000
    || !roleStatuses.has(record.status)
    || record.version < BigInt(0)
    || record.permissionKeys.some((key) => !permissionKeyPattern.test(key) || key.length > 128)
  ) {
    return invalid("RoleRecord");
  }
  return Object.freeze({
    id: record.id,
    organizationId: record.organizationId,
    key: record.key as AdminRoleKey,
    name: record.name,
    description: record.description,
    builtIn: record.builtIn,
    status: record.status as AdminRole["status"],
    version: record.version,
    permissionKeys: Object.freeze([...record.permissionKeys]),
  });
}

export function permissionFromRecord(record: PermissionRecord | undefined): AdminPermission {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !permissionKeyPattern.test(record.key)
    || record.key.length > 128
    || !roleKeyPattern.test(record.resource)
    || !roleKeyPattern.test(record.action)
    || record.description.length > 1_000
    || !permissionStatuses.has(record.status)
  ) {
    return invalid("PermissionRecord");
  }
  return Object.freeze({
    id: record.id,
    key: record.key,
    resource: record.resource,
    action: record.action,
    description: record.description,
    status: record.status as AdminPermission["status"],
  });
}

export function authorizationFromResponse(response: AuthorizeResponse | undefined): AdminAuthorizationDecision {
  if (
    response === undefined
    || !authorizationReasons.has(response.reasonCode as AdminAuthorizationReason)
    || !uuidPattern.test(response.userId)
    || !uuidPattern.test(response.sessionId)
    || !uuidPattern.test(response.organizationId)
    || response.roleKeys.some((key) => !isAdminRoleKey(key))
    || response.authorizationVersion < BigInt(0)
    || response.allowed !== (response.reasonCode === "allowed")
  ) {
    return invalid("AuthorizeResponse");
  }
  return Object.freeze({
    allowed: response.allowed,
    reasonCode: response.reasonCode as AdminAuthorizationReason,
    userId: response.userId,
    sessionId: response.sessionId,
    organizationId: response.organizationId,
    roleKeys: Object.freeze(response.roleKeys.filter(isAdminRoleKey)),
    authorizationVersion: response.authorizationVersion,
    evaluatedAt: date(response.evaluatedAt, "AuthorizeResponse"),
  });
}

export function authorizationInspectionFromResponse(
  response: InspectUserAuthorizationResponse | undefined,
): AdminAuthorizationInspection {
  if (
    response === undefined
    || !authorizationReasons.has(response.reasonCode as AdminAuthorizationReason)
    || !uuidPattern.test(response.userId)
    || !uuidPattern.test(response.organizationId)
    || response.roleKeys.some((key) => !isAdminRoleKey(key))
    || response.authorizationVersion < BigInt(0)
    || response.allowed !== (response.reasonCode === "allowed")
  ) {
    return invalid("InspectUserAuthorizationResponse");
  }
  return Object.freeze({
    allowed: response.allowed,
    reasonCode: response.reasonCode as AdminAuthorizationReason,
    userId: response.userId,
    organizationId: response.organizationId,
    roleKeys: Object.freeze(response.roleKeys.filter(isAdminRoleKey)),
    authorizationVersion: response.authorizationVersion,
    evaluatedAt: date(response.evaluatedAt, "InspectUserAuthorizationResponse"),
  });
}

export function siteAuthorizationFromResponse(
  response: AuthorizeSiteResponse | undefined,
): AdminSiteAuthorizationDecision {
  if (
    response === undefined
    || !authorizationReasons.has(response.reasonCode as AdminAuthorizationReason)
    || !uuidPattern.test(response.userId)
    || !uuidPattern.test(response.sessionId)
    || !uuidPattern.test(response.siteId)
    || response.roleKeys.some((key) => !isAdminRoleKey(key))
    || response.authorizationVersion < BigInt(0)
    || response.allowed !== (response.reasonCode === "allowed")
  ) return invalid("AuthorizeSiteResponse");
  return Object.freeze({
    allowed: response.allowed,
    reasonCode: response.reasonCode as AdminAuthorizationReason,
    userId: response.userId,
    sessionId: response.sessionId,
    siteId: response.siteId,
    roleKeys: Object.freeze(response.roleKeys.filter(isAdminRoleKey)),
    authorizationVersion: response.authorizationVersion,
    evaluatedAt: date(response.evaluatedAt, "AuthorizeSiteResponse"),
  });
}

export function siteAuthorizationInspectionFromResponse(
  response: InspectUserSiteAuthorizationResponse | undefined,
): AdminSiteAuthorizationInspection {
  if (
    response === undefined
    || !authorizationReasons.has(response.reasonCode as AdminAuthorizationReason)
    || !uuidPattern.test(response.userId)
    || !uuidPattern.test(response.siteId)
    || response.roleKeys.some((key) => !isAdminRoleKey(key))
    || response.authorizationVersion < BigInt(0)
    || response.allowed !== (response.reasonCode === "allowed")
  ) return invalid("InspectUserSiteAuthorizationResponse");
  return Object.freeze({
    allowed: response.allowed,
    reasonCode: response.reasonCode as AdminAuthorizationReason,
    userId: response.userId,
    siteId: response.siteId,
    roleKeys: Object.freeze(response.roleKeys.filter(isAdminRoleKey)),
    authorizationVersion: response.authorizationVersion,
    evaluatedAt: date(response.evaluatedAt, "InspectUserSiteAuthorizationResponse"),
  });
}

export function sessionFromRecord(record: SessionSummaryRecord | undefined): AdminSession {
  if (
    record === undefined
    || !uuidPattern.test(record.id)
    || !uuidPattern.test(record.userId)
    || (record.activeOrganizationId !== undefined && !uuidPattern.test(record.activeOrganizationId))
    || (record.activeSiteId !== undefined && !uuidPattern.test(record.activeSiteId))
  ) {
    return invalid("SessionSummaryRecord");
  }
  return Object.freeze({
    id: record.id,
    userId: record.userId,
    expiresAt: date(record.expires, "SessionSummaryRecord"),
    activeOrganizationId: record.activeOrganizationId ?? null,
    activeSiteId: record.activeSiteId ?? null,
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
    record?.siteId,
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
  ) {
    return invalid("SecurityEventRecord");
  }
  return Object.freeze({
    id: record.id,
    kind: record.kind,
    actorUserId: record.actorUserId ?? null,
    targetUserId: record.targetUserId ?? null,
    organizationId: record.organizationId ?? null,
    siteId: record.siteId ?? null,
    sessionId: record.sessionId ?? null,
    requestId: record.requestId,
    commandId: record.commandId ?? null,
    metadataJson: record.metadataJson.length > 4_096 ? null : record.metadataJson,
    createdAt: date(record.createdAt, "SecurityEventRecord"),
  });
}
