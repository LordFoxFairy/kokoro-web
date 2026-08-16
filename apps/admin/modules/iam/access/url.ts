import type { AccessFilters } from "./schema";

export function accessHref(filters: AccessFilters, organizationCursor?: string): string {
  const params = new URLSearchParams();
  if (filters.organizationId !== null) params.set("organizationId", filters.organizationId);
  if (filters.organizationQuery.length > 0) params.set("organizationQuery", filters.organizationQuery);
  params.set("organizationLimit", String(filters.organizationLimit));
  if (filters.userId !== null) params.set("userId", filters.userId);
  if (filters.userQuery.length > 0) params.set("userQuery", filters.userQuery);
  if (filters.permissionKey !== null) params.set("permissionKey", filters.permissionKey);
  if (filters.resourceRef !== null) params.set("resourceRef", filters.resourceRef);
  if (organizationCursor !== undefined && organizationCursor.length > 0) {
    params.set("organizationCursor", organizationCursor);
  }
  return `/access?${params.toString()}`;
}
