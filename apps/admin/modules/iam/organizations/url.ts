import type { MemberFilters, OrganizationFilters } from "./schema";

export function organizationListHref(filters: OrganizationFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.query.length > 0) params.set("query", filters.query);
  params.set("status", filters.status);
  if (filters.includeDeleted) params.set("includeDeleted", "true");
  params.set("limit", String(filters.limit));
  if (cursor !== undefined && cursor.length > 0) params.set("cursor", cursor);
  return `/organizations?${params.toString()}`;
}

export function organizationDetailHref(
  organizationId: string,
  filters: MemberFilters,
  cursor?: string,
): string {
  const params = new URLSearchParams();
  if (filters.query !== undefined && filters.query.length > 0) params.set("memberQuery", filters.query);
  if (filters.includeDeleted) params.set("includeDeletedMembers", "true");
  params.set("memberLimit", String(filters.limit));
  if (cursor !== undefined && cursor.length > 0) params.set("memberCursor", cursor);
  return `/organizations/${organizationId}?${params.toString()}`;
}
