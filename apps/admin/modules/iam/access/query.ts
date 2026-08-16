import "server-only";

import { randomUUID } from "node:crypto";

import type { IamManagementClient } from "../../../server/iam/management-client";
import type {
  AdminAuthorizationInspection,
  AdminPermission,
  AdminRole,
  AdminUser,
} from "../../../server/iam/records";
import {
  accessFiltersSchema,
  type AccessDecision,
  type AccessFilters,
    type AccessPermission,
    type AccessRole,
    type AccessUser,
  type AccessView,
} from "./schema";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseAccessFilters(value: SearchParams): AccessFilters {
  const allowed = new Set([
    "organizationId",
    "organizationQuery",
    "organizationCursor",
    "organizationLimit",
    "userId",
    "userQuery",
    "permissionKey",
    "resourceRef",
  ]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid access filters");
  }
  const organizationId = scalar(value.organizationId);
  const organizationCursor = scalar(value.organizationCursor);
  const rawOrganizationLimit = Number(scalar(value.organizationLimit) ?? "25");
  const permissionKey = scalar(value.permissionKey);
  const userId = scalar(value.userId);
  const resourceRef = scalar(value.resourceRef);
  const result = accessFiltersSchema.safeParse({
    organizationId: organizationId === undefined || organizationId.length === 0 ? null : organizationId,
    organizationQuery: scalar(value.organizationQuery) ?? "",
    organizationCursor: organizationCursor === undefined || organizationCursor.length === 0 ? null : organizationCursor,
    organizationLimit: Number.isFinite(rawOrganizationLimit)
      ? Math.min(100, Math.max(1, Math.trunc(rawOrganizationLimit)))
      : rawOrganizationLimit,
    userId: userId === undefined || userId.length === 0 ? null : userId,
    userQuery: scalar(value.userQuery) ?? "",
    permissionKey: permissionKey === undefined || permissionKey.length === 0 ? null : permissionKey,
    resourceRef: resourceRef === undefined || resourceRef.trim().length === 0 ? null : resourceRef,
  });
  if (
    !result.success
    || (result.data.permissionKey !== null
      && (result.data.organizationId === null || result.data.userId === null))
  ) {
    throw new Error("invalid access filters");
  }
  return Object.freeze(result.data);
}

export async function loadAccess(client: IamManagementClient, raw: SearchParams): Promise<AccessView> {
  const filters = parseAccessFilters(raw);
  const [organizationResult, userResult, permissions] = await Promise.all([
    client.listOrganizations({
      requestId: randomUUID(),
      query: filters.organizationQuery,
      status: "active",
      includeDeleted: false,
      ...(filters.organizationCursor === null ? {} : { cursor: filters.organizationCursor }),
      limit: filters.organizationLimit,
    }),
    client.listUsers({
      requestId: randomUUID(),
      query: filters.userQuery,
      status: "active",
      includeDeleted: false,
      limit: 100,
    }),
    client.listPermissionCatalog({ requestId: randomUUID() }),
  ]);
  let selectedOrganization = filters.organizationId === null
    ? null
    : organizationResult.items.find((organization) => organization.id === filters.organizationId) ?? null;
  if (filters.organizationId !== null && selectedOrganization === null) {
    selectedOrganization = await client.getOrganization({
      requestId: randomUUID(),
      organizationId: filters.organizationId,
      includeDeleted: false,
    });
    if (
      selectedOrganization === null
      || selectedOrganization.id !== filters.organizationId
      || selectedOrganization.status !== "active"
    ) {
      throw new Error("invalid access organization");
    }
  }
  let selectedUser = filters.userId === null
    ? null
    : userResult.items.find((user) => user.id === filters.userId) ?? null;
  if (filters.userId !== null && selectedUser === null) {
    selectedUser = await client.getUser({
      requestId: randomUUID(),
      userId: filters.userId,
      includeDeleted: false,
    });
    if (selectedUser === null || selectedUser.id !== filters.userId || selectedUser.status !== "active") {
      throw new Error("invalid access user");
    }
  }
  const roles = filters.organizationId === null
    ? []
    : await client.listRoleCatalog({ requestId: randomUUID(), organizationId: filters.organizationId });
  if (filters.organizationId !== null && roles.some((role) => role.organizationId !== filters.organizationId)) {
    throw new Error("invalid access role scope");
  }
  const decision = filters.organizationId === null || filters.userId === null || filters.permissionKey === null
    ? null
    : await client.inspectUserAuthorization({
        requestId: randomUUID(),
        organizationId: filters.organizationId,
        userId: filters.userId,
        permissionKey: filters.permissionKey,
        ...(filters.resourceRef === null ? {} : { resourceRef: filters.resourceRef }),
      });
  if (
    decision !== null
    && (decision.organizationId !== filters.organizationId || decision.userId !== filters.userId)
  ) {
    throw new Error("invalid access decision scope");
  }

  const organizations = selectedOrganization === null || organizationResult.items.some(({ id }) => id === selectedOrganization.id)
    ? organizationResult.items
    : [...organizationResult.items, selectedOrganization];
  const users = selectedUser === null || userResult.items.some(({ id }) => id === selectedUser.id)
    ? userResult.items
    : [...userResult.items, selectedUser];
  return Object.freeze({
    organizations: Object.freeze(organizations.map((organization) => Object.freeze({
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
    }))),
    nextOrganizationCursor: organizationResult.nextCursor,
    users: Object.freeze(users.map(userView)),
    roles: Object.freeze(roles.map(roleView)),
    permissions: Object.freeze(permissions.map(permissionView)),
    filters,
    decision: decision === null ? null : decisionView(decision),
  });
}

function roleView(role: AdminRole): AccessRole {
  return Object.freeze({
    key: role.key,
    name: role.name,
    description: role.description,
    builtIn: role.builtIn,
    status: role.status,
    permissionKeys: role.permissionKeys,
  });
}

function permissionView(permission: AdminPermission): AccessPermission {
  return Object.freeze({
    key: permission.key,
    resource: permission.resource,
    action: permission.action,
    description: permission.description,
    status: permission.status,
  });
}

function userView(user: AdminUser): AccessUser {
  return Object.freeze({ id: user.id, email: user.email, name: user.name });
}

function decisionView(decision: AdminAuthorizationInspection): AccessDecision {
  return Object.freeze({
    allowed: decision.allowed,
    reasonCode: decision.reasonCode,
    userId: decision.userId,
    organizationId: decision.organizationId,
    roleKeys: decision.roleKeys,
    authorizationVersion: decision.authorizationVersion.toString(),
    evaluatedAt: decision.evaluatedAt.toISOString(),
  });
}
