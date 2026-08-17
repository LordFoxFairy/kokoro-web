import type { SiteDetailFilters, SiteFilters } from "./schema";

export function siteListHref(filters: SiteFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.query.length > 0) params.set("query", filters.query);
  params.set("status", filters.status);
  if (filters.includeDeleted) params.set("includeDeleted", "true");
  params.set("limit", String(filters.limit));
  if (cursor !== undefined && cursor.length > 0) params.set("cursor", cursor);
  return `/sites?${params.toString()}`;
}

export function siteDetailHref(siteId: string, filters: SiteDetailFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.memberQuery.length > 0) params.set("memberQuery", filters.memberQuery);
  if (filters.includeDeletedMembers) params.set("includeDeletedMembers", "true");
  params.set("memberLimit", String(filters.memberLimit));
  if (cursor !== undefined && cursor.length > 0) params.set("memberCursor", cursor);
  if (filters.permissionKey !== null) params.set("permissionKey", filters.permissionKey);
  if (filters.authorizationUserId !== null) params.set("authorizationUserId", filters.authorizationUserId);
  if (filters.resourceRef !== null) params.set("resourceRef", filters.resourceRef);
  return `/sites/${siteId}?${params.toString()}`;
}
