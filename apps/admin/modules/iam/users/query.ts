import "server-only";

import { randomUUID } from "node:crypto";

import type { IamManagementClient } from "../../../server/iam/management-client";
import type { AdminUser } from "../../../server/iam/records";
import { loadSessions, parseSessionFilters } from "../sessions/query";
import { userFiltersSchema, type UserDetailView, type UserFilters, type UserListItem, type UserListView } from "./schema";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseUserFilters(value: SearchParams): UserFilters {
  const allowed = new Set(["query", "status", "includeDeleted", "cursor", "limit"]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid user filters");
  }
  const status = scalar(value.status) ?? "all";
  const includeDeleted = scalar(value.includeDeleted);
  const cursor = scalar(value.cursor);
  const rawLimit = Number(scalar(value.limit) ?? "25");
  const result = userFiltersSchema.safeParse({
    query: scalar(value.query) ?? "",
    status,
    includeDeleted: includeDeleted === undefined ? false : includeDeleted === "true",
    cursor: cursor === undefined || cursor.length === 0 ? null : cursor,
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : rawLimit,
  });
  if (!result.success || (includeDeleted !== undefined && includeDeleted !== "true" && includeDeleted !== "false")) {
    throw new Error("invalid user filters");
  }
  return Object.freeze(result.data);
}

export async function loadUsers(client: IamManagementClient, raw: SearchParams): Promise<UserListView> {
  const filters = parseUserFilters(raw);
  const result = await client.listUsers({
    requestId: randomUUID(),
    query: filters.query,
    ...(filters.status === "all" ? {} : { status: filters.status }),
    includeDeleted: filters.includeDeleted || filters.status === "deleted",
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
    limit: filters.limit,
  });
  return Object.freeze({
    items: Object.freeze(result.items.map(userView)),
    nextCursor: result.nextCursor,
    filters,
  });
}

export async function loadUserDetail(client: IamManagementClient, userId: string): Promise<UserDetailView | null> {
  const requestId = randomUUID();
  const user = await client.getUser({ requestId, userId, includeDeleted: true });
  if (user === null) return null;
  const [sessions, events] = await Promise.all([
    loadSessions(client, parseSessionFilters({ userId })),
    client.listSecurityEvents({ requestId: randomUUID(), targetUserId: userId, limit: 25 }),
  ]);
  return Object.freeze({
    user: userView(user),
    sessions,
    events: Object.freeze(events.items.map((event) => Object.freeze({
      id: event.id,
      kind: event.kind,
      requestId: event.requestId,
      commandId: event.commandId,
      createdAt: event.createdAt.toISOString(),
    }))),
  });
}

function userView(user: AdminUser): UserListItem {
  return Object.freeze({
    id: user.id,
    email: user.email,
    name: user.name,
    platformRole: user.platformRole,
    status: user.status,
    version: user.version.toString(),
    deletedAt: user.deletedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  });
}
