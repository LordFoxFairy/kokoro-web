import type { UserFilters } from "./schema";

export function userListHref(filters: UserFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.query.length > 0) params.set("query", filters.query);
  params.set("status", filters.status);
  if (filters.includeDeleted) params.set("includeDeleted", "true");
  params.set("limit", String(filters.limit));
  if (cursor !== undefined && cursor.length > 0) params.set("cursor", cursor);
  return `/users?${params.toString()}`;
}
