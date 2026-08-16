import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import type { IamManagementClient } from "../../../server/iam/management-client";
import type { AdminSession } from "../../../server/iam/records";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;
const sessionFiltersSchema = z.object({
  userId: z.string().uuid().nullable().default(null),
  cursor: z.string().max(512).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export type SessionFilters = z.infer<typeof sessionFiltersSchema>;
export type SessionListItem = Readonly<{
  id: string;
  userId: string;
  status: "active" | "revoked" | "expired";
  activeOrganizationId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type SessionListView = Readonly<{
  items: readonly SessionListItem[];
  nextCursor: string | null;
  filters: SessionFilters;
}>;

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function parseSessionFilters(value: SearchParams): SessionFilters {
  const allowed = new Set(["userId", "cursor", "limit"]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid session filters");
  }
  const cursor = scalar(value.cursor);
  const userId = scalar(value.userId);
  const rawLimit = Number(scalar(value.limit) ?? "25");
  const result = sessionFiltersSchema.safeParse({
    userId: userId === undefined || userId.length === 0 ? null : userId,
    cursor: cursor === undefined || cursor.length === 0 ? null : cursor,
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : rawLimit,
  });
  if (!result.success) throw new Error("invalid session filters");
  return Object.freeze(result.data);
}

export async function loadSessions(
  client: IamManagementClient,
  filtersOrRaw: SessionFilters | SearchParams,
): Promise<SessionListView> {
  const filters = "limit" in filtersOrRaw && typeof filtersOrRaw.limit === "number"
    ? filtersOrRaw as SessionFilters
    : parseSessionFilters(filtersOrRaw as SearchParams);
  const result = await client.listSessions({
    requestId: randomUUID(),
    ...(filters.userId === null ? {} : { userId: filters.userId }),
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
    limit: filters.limit,
  });
  return Object.freeze({
    items: Object.freeze(result.items.map(sessionView)),
    nextCursor: result.nextCursor,
    filters,
  });
}

function sessionView(session: AdminSession): SessionListItem {
  const status = session.revokedAt !== null
    ? "revoked"
    : session.expiresAt.getTime() <= Date.now() ? "expired" : "active";
  return Object.freeze({
    id: session.id,
    userId: session.userId,
    status,
    activeOrganizationId: session.activeOrganizationId,
    expiresAt: session.expiresAt.toISOString(),
    revokedAt: session.revokedAt?.toISOString() ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  });
}
