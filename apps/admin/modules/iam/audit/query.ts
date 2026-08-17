import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { iamRoleKeys } from "../../../lib/iam-values";
import type { IamManagementClient } from "../../../server/iam/management-client";
import type { AdminSecurityEvent } from "../../../server/iam/records";
import {
  auditFiltersSchema,
  type AuditEventView,
  type AuditFilters,
  type AuditMetadata,
  type AuditView,
} from "./schema";

type SearchParams = Readonly<Record<string, string | string[] | undefined>>;

const safeMetadataSchema = z.object({
  slug: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u).max(80).optional(),
  name: z.string().trim().min(1).max(160).optional(),
  roleKey: z.enum(iamRoleKeys).optional(),
  revoked: z.boolean().optional(),
  revokedCount: z.number().int().min(0).max(1_000_000).optional(),
});
const secretKey = /(?:authorization|cookie|credential|password|private|secret|session.?token|token)/iu;
const secretValue = /(?:bearer\s+|-----BEGIN|(?:authorization|cookie|credential|password|secret|token)\s*[=:])/iu;

function scalar(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nullable(value: string | undefined): string | null {
  return value === undefined || value.trim().length === 0 ? null : value;
}

export function parseAuditFilters(value: SearchParams): AuditFilters {
  const allowed = new Set([
    "kind",
    "actorUserId",
    "targetUserId",
    "organizationId",
    "siteId",
    "commandId",
    "createdAfter",
    "createdBefore",
    "cursor",
    "limit",
  ]);
  if (Object.entries(value).some(([key, item]) => !allowed.has(key) || Array.isArray(item))) {
    throw new Error("invalid audit filters");
  }
  const rawLimit = Number(scalar(value.limit) ?? "25");
  const result = auditFiltersSchema.safeParse({
    kind: nullable(scalar(value.kind)),
    actorUserId: nullable(scalar(value.actorUserId)),
    targetUserId: nullable(scalar(value.targetUserId)),
    organizationId: nullable(scalar(value.organizationId)),
    siteId: nullable(scalar(value.siteId)),
    commandId: nullable(scalar(value.commandId)),
    createdAfter: nullable(scalar(value.createdAfter)),
    createdBefore: nullable(scalar(value.createdBefore)),
    cursor: nullable(scalar(value.cursor)),
    limit: Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : rawLimit,
  });
  if (!result.success) throw new Error("invalid audit filters");
  if (
    result.data.createdAfter !== null
    && result.data.createdBefore !== null
    && new Date(result.data.createdAfter).getTime() >= new Date(result.data.createdBefore).getTime()
  ) {
    throw new Error("invalid audit filters");
  }
  return Object.freeze(result.data);
}

export async function loadAudit(client: IamManagementClient, raw: SearchParams): Promise<AuditView> {
  const filters = parseAuditFilters(raw);
  const result = await client.listSecurityEvents({
    requestId: randomUUID(),
    ...(filters.kind === null ? {} : { kind: filters.kind }),
    ...(filters.actorUserId === null ? {} : { actorUserId: filters.actorUserId }),
    ...(filters.targetUserId === null ? {} : { targetUserId: filters.targetUserId }),
    ...(filters.organizationId === null ? {} : { organizationId: filters.organizationId }),
    ...(filters.siteId === null ? {} : { siteId: filters.siteId }),
    ...(filters.commandId === null ? {} : { commandId: filters.commandId }),
    ...(filters.createdAfter === null ? {} : { createdAfter: new Date(filters.createdAfter) }),
    ...(filters.createdBefore === null ? {} : { createdBefore: new Date(filters.createdBefore) }),
    ...(filters.cursor === null ? {} : { cursor: filters.cursor }),
    limit: filters.limit,
  });
  return Object.freeze({
    filters,
    items: Object.freeze(result.items.map(auditEventView)),
    statistics: Object.freeze({
      total: result.statistics.total.toString(),
      byKind: Object.freeze(result.statistics.byKind.map((item) => Object.freeze({
        kind: item.kind,
        count: item.count.toString(),
      }))),
    }),
    nextCursor: result.nextCursor,
  });
}

export function projectAuditMetadata(source: string | null): AuditMetadata | null {
  if (source === null || source.length === 0 || source.length > 4_096) return null;
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch {
    return null;
  }
  if (!isPlainRecord(value) || containsSecret(value)) return null;
  const parsed = safeMetadataSchema.safeParse(value);
  if (!parsed.success) return null;
  const projected = Object.fromEntries(
    Object.entries(parsed.data).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined),
  );
  return Object.keys(projected).length === 0 ? null : Object.freeze(projected);
}

export function auditEventView(event: AdminSecurityEvent): AuditEventView {
  return Object.freeze({
    id: event.id,
    kind: event.kind,
    actorUserId: event.actorUserId,
    targetUserId: event.targetUserId,
    organizationId: event.organizationId,
    siteId: event.siteId,
    sessionId: event.sessionId,
    requestId: event.requestId,
    commandId: event.commandId,
    metadata: projectAuditMetadata(event.metadataJson),
    createdAt: event.createdAt.toISOString(),
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function containsSecret(value: unknown): boolean {
  if (typeof value === "string") return secretValue.test(value);
  if (Array.isArray(value)) return value.some(containsSecret);
  if (!isPlainRecord(value)) return false;
  return Object.entries(value).some(([key, item]) => secretKey.test(key) || containsSecret(item));
}
