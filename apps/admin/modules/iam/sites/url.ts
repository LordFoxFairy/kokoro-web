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
  if (filters.tab !== "overview") params.set("tab", filters.tab);
  if (filters.memberQuery.length > 0) params.set("memberQuery", filters.memberQuery);
  if (filters.includeDeletedMembers) params.set("includeDeletedMembers", "true");
  params.set("memberLimit", String(filters.memberLimit));
  const memberCursor = cursor ?? filters.memberCursor;
  if (memberCursor !== null && memberCursor !== undefined && memberCursor.length > 0) params.set("memberCursor", memberCursor);
  if (filters.permissionKey !== null) params.set("permissionKey", filters.permissionKey);
  if (filters.authorizationUserId !== null) params.set("authorizationUserId", filters.authorizationUserId);
  if (filters.resourceRef !== null) params.set("resourceRef", filters.resourceRef);
  if (filters.auditKind !== null) params.set("auditKind", filters.auditKind);
  if (filters.auditActorUserId !== null) params.set("auditActorUserId", filters.auditActorUserId);
  if (filters.auditTargetUserId !== null) params.set("auditTargetUserId", filters.auditTargetUserId);
  params.set("auditLimit", String(filters.auditLimit));
  if (filters.auditCursor !== null) params.set("auditCursor", filters.auditCursor);
  return `/sites/${siteId}?${params.toString()}`;
}
