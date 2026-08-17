import { z } from "zod";

import { iamRoleKeys, type IamRoleKey } from "../../../lib/iam-values";

export const siteIdSchema = z.string().uuid();
export const siteCodeSchema = z.string().trim().regex(/^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u);
export const siteNameSchema = z.string().trim().min(1).max(160);
export const siteRoleKeySchema = z.enum(iamRoleKeys);
export const sitePermissionKeySchema = z.string().trim()
  .regex(/^(?:site|site_member):[a-z][a-z0-9_]*$/u)
  .max(128);
const versionSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const commandIdentity = {
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
};

export const siteStatusSchema = z.enum(["all", "active", "suspended", "deleted"]);
export const siteFiltersSchema = z.object({
  query: z.string().trim().max(160).default(""),
  status: siteStatusSchema.default("all"),
  includeDeleted: z.boolean().default(false),
  cursor: z.string().max(512).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export const siteDetailFiltersSchema = z.object({
  memberQuery: z.string().trim().max(320).default(""),
  includeDeletedMembers: z.boolean().default(false),
  memberCursor: z.string().max(512).nullable().default(null),
  memberLimit: z.number().int().min(1).max(100).default(25),
  permissionKey: sitePermissionKeySchema.nullable().default(null),
  authorizationUserId: z.string().uuid().nullable().default(null),
  resourceRef: z.string().trim().min(1).max(320).nullable().default(null),
}).strict().superRefine((value, context) => {
  if (value.permissionKey === null && (value.authorizationUserId !== null || value.resourceRef !== null)) {
    context.addIssue({ code: "custom", path: ["permissionKey"], message: "permissionKey is required" });
  }
});

export const siteCommandInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"), code: siteCodeSchema, name: siteNameSchema, ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.literal("update"), siteId: siteIdSchema, name: siteNameSchema,
    expectedVersion: versionSchema, ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.enum(["suspend", "reactivate", "delete", "restore", "select"]),
    siteId: siteIdSchema, expectedVersion: versionSchema, ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.literal("add-member"), siteId: siteIdSchema, userId: z.string().uuid(),
    roleKey: siteRoleKeySchema, ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.literal("change-member-role"), siteId: siteIdSchema, memberId: z.string().uuid(),
    roleKey: siteRoleKeySchema, expectedVersion: versionSchema, ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.enum(["suspend-member", "reactivate-member", "remove-member", "restore-member"]),
    siteId: siteIdSchema, memberId: z.string().uuid(), expectedVersion: versionSchema, ...commandIdentity,
  }).strict(),
]);

export type SiteCommandActionInput = z.input<typeof siteCommandInputSchema>;
export type SiteFilters = z.infer<typeof siteFiltersSchema>;
export type SiteDetailFilters = z.infer<typeof siteDetailFiltersSchema>;
export type SiteListItem = Readonly<{
  id: string;
  code: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  version: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type SiteListView = Readonly<{
  items: readonly SiteListItem[];
  nextCursor: string | null;
  filters: SiteFilters;
}>;
export type SiteRoleOption = Readonly<{ key: IamRoleKey; label: string }>;
export type SiteUserOption = Readonly<{ id: string; email: string; name: string }>;
export type SiteMemberListItem = Readonly<{
  id: string;
  siteId: string;
  userId: string;
  userLabel: string;
  roleKey: IamRoleKey;
  status: "active" | "suspended" | "deleted";
  version: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type SiteMemberListView = Readonly<{
  items: readonly SiteMemberListItem[];
  nextCursor: string | null;
  filters: Pick<SiteDetailFilters, "memberQuery" | "includeDeletedMembers" | "memberCursor" | "memberLimit">;
  roleOptions: readonly SiteRoleOption[];
  userOptions: readonly SiteUserOption[];
}>;
export type SiteAuthorizationView = Readonly<{
  allowed: boolean;
  reasonCode: string;
  userId: string;
  siteId: string;
  roleKeys: readonly IamRoleKey[];
  authorizationVersion: string;
  evaluatedAt: string;
}>;
export type SiteAuditEventView = Readonly<{
  id: string;
  kind: string;
  actorUserId: string | null;
  targetUserId: string | null;
  siteId: string;
  requestId: string;
  commandId: string | null;
  createdAt: string;
}>;
export type SiteDetailView = Readonly<{
  site: SiteListItem;
  members: SiteMemberListView;
  permissionKeys: readonly string[];
  authorization: SiteAuthorizationView | null;
  audit: Readonly<{
    items: readonly SiteAuditEventView[];
    nextCursor: string | null;
    statistics: Readonly<{ total: string; byKind: readonly Readonly<{ kind: string; count: string }>[] }>;
  }>;
}>;
