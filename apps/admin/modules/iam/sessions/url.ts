import type { SessionFilters } from "./query";

export function sessionListHref(filters: SessionFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.userId !== null) params.set("userId", filters.userId);
  params.set("limit", String(filters.limit));
  if (cursor !== undefined && cursor.length > 0) params.set("cursor", cursor);
  return `/sessions?${params.toString()}`;
}
