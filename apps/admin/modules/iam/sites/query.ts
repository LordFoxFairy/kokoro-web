import "server-only";

import { randomUUID } from "node:crypto";

import type { IamManagementClient } from "../../../server/iam/management-client";
import type {
  AdminPermission, AdminSite, AdminSiteAuthorizationDecision, AdminSiteAuthorizationInspection, AdminSiteMember, AdminSiteRole,
} from "../../../server/iam/records";
import {
  siteDetailFiltersSchema, siteFiltersSchema, siteIdSchema,
  type SiteAuthorizationView, type SiteDetailFilters, type SiteDetailView, type SiteFilters,
  type SiteListItem, type SiteListView, type SiteMemberListItem,
} from "./schema";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullable(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

export function parseSiteFilters(value: SearchParams): SiteFilters {
  const allowed = new Set(["query", "status", "includeDeleted", "cursor", "limit"]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid site filters");
  }
  const includeDeleted = scalar(value.includeDeleted);
  const rawLimit = Number(scalar(value.limit) ?? "25");
  const result = siteFiltersSchema.safeParse({
    query: scalar(value.query) ?? "",
    status: scalar(value.status) ?? "all",
    includeDeleted: includeDeleted === undefined ? false : includeDeleted === "true",
    cursor: nullable(scalar(value.cursor)),
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : rawLimit,
  });
  if (!result.success || (includeDeleted !== undefined && includeDeleted !== "true" && includeDeleted !== "false")) {
    throw new Error("invalid site filters");
  }
  return Object.freeze(result.data);
}

export function parseSiteDetailFilters(value: SearchParams): SiteDetailFilters {
  const allowed = new Set([
    "tab",
    "memberQuery", "includeDeletedMembers", "memberCursor", "memberLimit",
    "permissionKey", "authorizationUserId", "resourceRef",
    "auditKind", "auditActorUserId", "auditTargetUserId", "auditCursor", "auditLimit",
  ]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid site detail filters");
  }
  const includeDeleted = scalar(value.includeDeletedMembers);
  const rawLimit = Number(scalar(value.memberLimit) ?? "25");
  const rawAuditLimit = Number(scalar(value.auditLimit) ?? "25");
  const result = siteDetailFiltersSchema.safeParse({
    tab: scalar(value.tab) ?? "overview",
    memberQuery: scalar(value.memberQuery) ?? "",
    includeDeletedMembers: includeDeleted === undefined ? false : includeDeleted === "true",
    memberCursor: nullable(scalar(value.memberCursor)),
    memberLimit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : rawLimit,
    permissionKey: nullable(scalar(value.permissionKey)),
    authorizationUserId: nullable(scalar(value.authorizationUserId)),
    resourceRef: nullable(scalar(value.resourceRef)),
    auditKind: nullable(scalar(value.auditKind)),
    auditActorUserId: nullable(scalar(value.auditActorUserId)),
    auditTargetUserId: nullable(scalar(value.auditTargetUserId)),
    auditCursor: nullable(scalar(value.auditCursor)),
    auditLimit: Number.isFinite(rawAuditLimit) ? Math.min(100, Math.max(1, Math.trunc(rawAuditLimit))) : rawAuditLimit,
  });
  if (!result.success || (includeDeleted !== undefined && includeDeleted !== "true" && includeDeleted !== "false")) {
    throw new Error("invalid site detail filters");
  }
  return Object.freeze(result.data);
}

export async function loadSites(client: IamManagementClient, raw: SearchParams): Promise<SiteListView> {
  const filters = parseSiteFilters(raw);
  const result = await client.listSites({
    requestId: randomUUID(), query: filters.query,
    ...(filters.status === "all" ? {} : { status: filters.status }),
    includeDeleted: filters.includeDeleted || filters.status === "deleted",
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }), limit: filters.limit,
  });
  return Object.freeze({ items: Object.freeze(result.items.map(siteView)), nextCursor: result.nextCursor, filters });
}

export async function loadSiteDetail(
  client: IamManagementClient,
  rawSiteId: string,
  raw: SearchParams = {},
): Promise<SiteDetailView | null> {
  const parsedSiteId = siteIdSchema.safeParse(rawSiteId);
  if (!parsedSiteId.success) throw new Error("invalid site id");
  const filters = parseSiteDetailFilters(raw);
  const site = await client.getSite({ requestId: randomUUID(), siteId: parsedSiteId.data, includeDeleted: true });
  if (site === null) return null;
  if (site.id !== parsedSiteId.data) throw new Error("invalid site scope");

  const [members, users, roles, permissions, audit, authorization] = await Promise.all([
    client.listSiteMembers({
      requestId: randomUUID(), siteId: site.id, includeDeleted: filters.includeDeletedMembers,
      ...(filters.memberCursor === null ? {} : { cursor: filters.memberCursor }), limit: filters.memberLimit,
    }),
    client.listUsers({
      requestId: randomUUID(), query: filters.memberQuery, status: "active", includeDeleted: false, limit: 25,
    }),
    client.listSiteRoles({ requestId: randomUUID(), siteId: site.id, includeDeleted: true }),
    client.listPermissionCatalog({ requestId: randomUUID() }),
    client.listSecurityEvents({
      requestId: randomUUID(), siteId: site.id,
      ...(filters.auditKind === null ? {} : { kind: filters.auditKind }),
      ...(filters.auditActorUserId === null ? {} : { actorUserId: filters.auditActorUserId }),
      ...(filters.auditTargetUserId === null ? {} : { targetUserId: filters.auditTargetUserId }),
      ...(filters.auditCursor === null ? {} : { cursor: filters.auditCursor }),
      limit: filters.auditLimit,
    }),
    loadAuthorization(client, site.id, filters),
  ]);
  if (members.items.some((member) => member.siteId !== site.id)) throw new Error("invalid site member scope");
  if (roles.some((role) => role.siteId !== site.id)) throw new Error("invalid site role scope");
  if (audit.items.some((event) => event.siteId !== site.id)) throw new Error("invalid site event scope");
  if (authorization !== null && authorization.siteId !== site.id) throw new Error("invalid site authorization scope");
  const userLabels = new Map(users.items.map((user) => [user.id, user.email]));

  return Object.freeze({
    site: siteView(site),
    filters,
    members: Object.freeze({
      items: Object.freeze(members.items.map((member) => memberView(member, userLabels.get(member.userId)))),
      nextCursor: members.nextCursor,
      filters: Object.freeze({
        memberQuery: filters.memberQuery, includeDeletedMembers: filters.includeDeletedMembers,
        memberCursor: filters.memberCursor, memberLimit: filters.memberLimit,
      }),
      roleOptions: Object.freeze(roles
        .filter((role) => role.status === "active")
        .map((role) => Object.freeze({ key: role.key, label: role.name }))),
      userOptions: Object.freeze(users.items.map((user) => Object.freeze({ id: user.id, email: user.email, name: user.name }))),
    }),
    roles: Object.freeze({
      items: Object.freeze(roles.map(roleView)),
      permissionGroups: permissionGroups(permissions),
    }),
    permissionKeys: Object.freeze(permissions
      .filter((permission) => permission.status === "active" && ["site", "site_member", "site_role"].includes(permission.resource))
      .map((permission) => permission.key)),
    authorization: authorization === null ? null : authorizationView(authorization),
    audit: Object.freeze({
      items: Object.freeze(audit.items.map((event) => Object.freeze({
        id: event.id, kind: event.kind, actorUserId: event.actorUserId, targetUserId: event.targetUserId,
        siteId: site.id, requestId: event.requestId, commandId: event.commandId, createdAt: event.createdAt.toISOString(),
      }))),
      nextCursor: audit.nextCursor,
      statistics: Object.freeze({
        total: audit.statistics.total.toString(),
        byKind: Object.freeze(audit.statistics.byKind.map((item) => Object.freeze({ kind: item.kind, count: item.count.toString() }))),
      }),
    }),
  });
}

function roleView(role: AdminSiteRole) {
  return Object.freeze({
    id: role.id, siteId: role.siteId, key: role.key, name: role.name, description: role.description,
    builtIn: role.builtIn, status: role.status, version: role.version.toString(), permissionKeys: role.permissionKeys,
  });
}

function permissionGroups(permissions: readonly AdminPermission[]) {
  const groups = new Map<string, Array<Readonly<{ key: string; action: string; description: string }>>>();
  for (const permission of permissions) {
    if (permission.status !== "active" || !["site", "site_member", "site_role"].includes(permission.resource)) continue;
    const values = groups.get(permission.resource) ?? [];
    values.push(Object.freeze({ key: permission.key, action: permission.action, description: permission.description }));
    groups.set(permission.resource, values);
  }
  return Object.freeze([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([resource, values]) => Object.freeze({
    resource, permissions: Object.freeze(values.sort((left, right) => left.key.localeCompare(right.key))),
  })));
}

async function loadAuthorization(client: IamManagementClient, siteId: string, filters: SiteDetailFilters) {
  if (filters.permissionKey === null) return null;
  const input = {
    requestId: randomUUID(), siteId, permissionKey: filters.permissionKey,
    ...(filters.resourceRef === null ? {} : { resourceRef: filters.resourceRef }),
  };
  return filters.authorizationUserId === null
    ? client.authorizeSite(input)
    : client.inspectUserSiteAuthorization({ ...input, userId: filters.authorizationUserId });
}

function siteView(site: AdminSite): SiteListItem {
  return Object.freeze({
    id: site.id, code: site.code, name: site.name, status: site.status, version: site.version.toString(),
    deletedAt: site.deletedAt?.toISOString() ?? null,
    createdAt: site.createdAt.toISOString(), updatedAt: site.updatedAt.toISOString(),
  });
}

function memberView(member: AdminSiteMember, userLabel?: string): SiteMemberListItem {
  return Object.freeze({
    id: member.id, siteId: member.siteId, userId: member.userId, userLabel: userLabel ?? member.userId,
    roleKey: member.roleKey, status: member.status, version: member.version.toString(),
    deletedAt: member.deletedAt?.toISOString() ?? null,
    createdAt: member.createdAt.toISOString(), updatedAt: member.updatedAt.toISOString(),
  });
}

function authorizationView(
  value: AdminSiteAuthorizationDecision | AdminSiteAuthorizationInspection,
): SiteAuthorizationView {
  return Object.freeze({
    allowed: value.allowed, reasonCode: value.reasonCode, userId: value.userId, siteId: value.siteId,
    roleKeys: value.roleKeys, authorizationVersion: value.authorizationVersion.toString(),
    evaluatedAt: value.evaluatedAt.toISOString(),
  });
}
