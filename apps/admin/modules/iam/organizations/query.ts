import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { IamManagementClient } from "../../../server/iam/management-client";
import type { AdminMember, AdminOrganization, AdminRole, AdminUser } from "../../../server/iam/records";
import {
  organizationFiltersSchema,
  organizationIdSchema,
  type ActiveUserOption,
  type MemberFilters,
  type MemberListItem,
  type OrganizationDetailView,
  type OrganizationFilters,
  type OrganizationListItem,
  type OrganizationListView,
  type RoleOption,
} from "./schema";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
const detailFiltersSchema = z.object({
  memberQuery: z.string().trim().max(320).default(""),
  includeDeletedMembers: z.boolean().default(false),
  memberCursor: z.string().max(512).nullable().default(null),
  memberLimit: z.number().int().min(1).max(100).default(25),
}).strict();

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseOrganizationFilters(value: SearchParams): OrganizationFilters {
  const allowed = new Set(["query", "status", "includeDeleted", "cursor", "limit"]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid organization filters");
  }
  const includeDeleted = scalar(value.includeDeleted);
  const cursor = scalar(value.cursor);
  const rawLimit = Number(scalar(value.limit) ?? "25");
  const result = organizationFiltersSchema.safeParse({
    query: scalar(value.query) ?? "",
    status: scalar(value.status) ?? "all",
    includeDeleted: includeDeleted === undefined ? false : includeDeleted === "true",
    cursor: cursor === undefined || cursor.length === 0 ? null : cursor,
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : rawLimit,
  });
  if (!result.success || (includeDeleted !== undefined && includeDeleted !== "true" && includeDeleted !== "false")) {
    throw new Error("invalid organization filters");
  }
  return Object.freeze(result.data);
}

export async function loadOrganizations(client: IamManagementClient, raw: SearchParams): Promise<OrganizationListView> {
  const filters = parseOrganizationFilters(raw);
  const result = await client.listOrganizations({
    requestId: randomUUID(),
    query: filters.query,
    ...(filters.status === "all" ? {} : { status: filters.status }),
    includeDeleted: filters.includeDeleted || filters.status === "deleted",
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
    limit: filters.limit,
  });
  return Object.freeze({
    items: Object.freeze(result.items.map(organizationView)),
    nextCursor: result.nextCursor,
    filters,
  });
}

export async function loadOrganizationDetail(
  client: IamManagementClient,
  rawOrganizationId: string,
  raw: SearchParams = {},
): Promise<OrganizationDetailView | null> {
  const organizationId = organizationIdSchema.safeParse(rawOrganizationId);
  if (!organizationId.success) throw new Error("invalid organization id");
  const filters = parseDetailFilters(raw);
  const organization = await client.getOrganization({
    requestId: randomUUID(),
    organizationId: organizationId.data,
    includeDeleted: true,
  });
  if (organization === null) return null;
  if (organization.id !== organizationId.data) throw new Error("invalid organization scope");

  const [memberResult, roles, users, eventResult] = await Promise.all([
    client.listMembers({
      requestId: randomUUID(),
      organizationId: organization.id,
      includeDeleted: filters.includeDeletedMembers,
      ...(filters.memberCursor === null ? {} : { cursor: filters.memberCursor }),
      limit: filters.memberLimit,
    }),
    client.listRoleCatalog({ requestId: randomUUID(), organizationId: organization.id }),
    client.listUsers({
      requestId: randomUUID(),
      query: filters.memberQuery,
      status: "active",
      includeDeleted: false,
      limit: 25,
    }),
    client.listSecurityEvents({ requestId: randomUUID(), organizationId: organization.id, limit: 25 }),
  ]);
  if (memberResult.items.some((member) => member.organizationId !== organization.id)) {
    throw new Error("invalid organization member scope");
  }
  if (eventResult.items.some((event) => event.organizationId !== organization.id)) {
    throw new Error("invalid organization event scope");
  }
  if (roles.some((role) => role.organizationId !== organization.id)) {
    throw new Error("invalid organization role scope");
  }
  const userLabels = new Map(users.items.map((user) => [user.id, user.email]));
  const memberFilters: MemberFilters = Object.freeze({
    query: filters.memberQuery,
    includeDeleted: filters.includeDeletedMembers,
    cursor: filters.memberCursor,
    limit: filters.memberLimit,
  });

  return Object.freeze({
    organization: organizationView(organization),
    members: Object.freeze({
      items: Object.freeze(memberResult.items.map((member) => memberView(member, userLabels.get(member.userId)))),
      nextCursor: memberResult.nextCursor,
      filters: memberFilters,
      roleOptions: Object.freeze(roles.filter((role) => role.status === "active").map(roleView)),
      userOptions: Object.freeze(users.items.map(userOption)),
    }),
    events: Object.freeze(eventResult.items.map((event) => Object.freeze({
      id: event.id,
      kind: event.kind,
      organizationId: organization.id,
      requestId: event.requestId,
      commandId: event.commandId,
      createdAt: event.createdAt.toISOString(),
    }))),
  });
}

function parseDetailFilters(value: SearchParams): z.infer<typeof detailFiltersSchema> {
  const allowed = new Set(["memberQuery", "includeDeletedMembers", "memberCursor", "memberLimit"]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid member filters");
  }
  const includeDeleted = scalar(value.includeDeletedMembers);
  const cursor = scalar(value.memberCursor);
  const rawLimit = Number(scalar(value.memberLimit) ?? "25");
  const result = detailFiltersSchema.safeParse({
    memberQuery: scalar(value.memberQuery) ?? "",
    includeDeletedMembers: includeDeleted === undefined ? false : includeDeleted === "true",
    memberCursor: cursor === undefined || cursor.length === 0 ? null : cursor,
    memberLimit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : rawLimit,
  });
  if (!result.success || (includeDeleted !== undefined && includeDeleted !== "true" && includeDeleted !== "false")) {
    throw new Error("invalid member filters");
  }
  return Object.freeze(result.data);
}

function organizationView(organization: AdminOrganization): OrganizationListItem {
  return Object.freeze({
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    status: organization.status,
    version: organization.version.toString(),
    deletedAt: organization.deletedAt?.toISOString() ?? null,
    createdAt: organization.createdAt.toISOString(),
    updatedAt: organization.updatedAt.toISOString(),
  });
}

function memberView(member: AdminMember, userLabel?: string): MemberListItem {
  return Object.freeze({
    id: member.id,
    organizationId: member.organizationId,
    userId: member.userId,
    userLabel: userLabel ?? member.userId,
    roleKey: member.roleKey,
    status: member.status,
    version: member.version.toString(),
    deletedAt: member.deletedAt?.toISOString() ?? null,
    createdAt: member.createdAt.toISOString(),
    updatedAt: member.updatedAt.toISOString(),
  });
}

function roleView(role: AdminRole): RoleOption {
  return Object.freeze({
    key: role.key,
    name: role.name,
    description: role.description,
    builtIn: role.builtIn,
    permissionKeys: role.permissionKeys,
  });
}

function userOption(user: AdminUser): ActiveUserOption {
  return Object.freeze({ id: user.id, email: user.email, name: user.name });
}
