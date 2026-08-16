import type { AuditFilters } from "./schema";

export function auditHref(filters: AuditFilters, cursor?: string): string {
  const params = new URLSearchParams();
  if (filters.kind !== null) params.set("kind", filters.kind);
  if (filters.actorUserId !== null) params.set("actorUserId", filters.actorUserId);
  if (filters.targetUserId !== null) params.set("targetUserId", filters.targetUserId);
  if (filters.organizationId !== null) params.set("organizationId", filters.organizationId);
  if (filters.commandId !== null) params.set("commandId", filters.commandId);
  if (filters.createdAfter !== null) params.set("createdAfter", filters.createdAfter);
  if (filters.createdBefore !== null) params.set("createdBefore", filters.createdBefore);
  params.set("limit", String(filters.limit));
  if (cursor !== undefined && cursor.length > 0) params.set("cursor", cursor);
  return `/audit?${params.toString()}`;
}
