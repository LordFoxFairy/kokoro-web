import { z } from "zod";

export const auditFiltersSchema = z.object({
  kind: z.string().trim().regex(/^[a-z][a-z0-9_.-]*$/u).max(96).nullable().default(null),
  actorUserId: z.string().uuid().nullable().default(null),
  targetUserId: z.string().uuid().nullable().default(null),
  organizationId: z.string().uuid().nullable().default(null),
  siteId: z.string().uuid().nullable().default(null),
  commandId: z.string().uuid().nullable().default(null),
  createdAfter: z.string().datetime({ offset: true }).nullable().default(null),
  createdBefore: z.string().datetime({ offset: true }).nullable().default(null),
  cursor: z.string().max(512).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export type AuditFilters = z.infer<typeof auditFiltersSchema>;
export type AuditMetadata = Readonly<Partial<{
  slug: string;
  name: string;
  roleKey: "owner" | "admin" | "member";
  revoked: boolean;
  revokedCount: number;
}>>;
export type AuditEventView = Readonly<{
  id: string;
  kind: string;
  actorUserId: string | null;
  targetUserId: string | null;
  organizationId: string | null;
  siteId: string | null;
  sessionId: string | null;
  requestId: string;
  commandId: string | null;
  metadata: AuditMetadata | null;
  createdAt: string;
}>;
export type AuditView = Readonly<{
  filters: AuditFilters;
  items: readonly AuditEventView[];
  statistics: Readonly<{
    total: string;
    byKind: readonly Readonly<{ kind: string; count: string }>[];
  }>;
  nextCursor: string | null;
}>;
