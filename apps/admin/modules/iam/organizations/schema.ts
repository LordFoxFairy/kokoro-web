import { z } from "zod";

import { iamRoleKeyPattern, type IamRoleKey } from "@/lib/iam-values";
import type { OrganizationRoleManagementView } from "../roles/schema";

export const organizationIdSchema = z.string().uuid();
export const organizationSlugSchema = z.string().trim().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/u,
);
export const organizationNameSchema = z.string().trim().min(1).max(160);
export const roleKeySchema = z.string().regex(iamRoleKeyPattern);
export type RoleKey = IamRoleKey;
const versionSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const commandIdentity = {
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
};

export const organizationStatusSchema = z.enum(["all", "active", "suspended", "deleted"]);
export const organizationFiltersSchema = z.object({
  query: z.string().trim().max(160).default(""),
  status: organizationStatusSchema.default("all"),
  includeDeleted: z.boolean().default(false),
  cursor: z.string().max(512).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export const organizationCommandInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    slug: organizationSlugSchema,
    name: organizationNameSchema,
    ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.literal("update"),
    organizationId: organizationIdSchema,
    name: organizationNameSchema,
    expectedVersion: versionSchema,
    ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.enum(["delete", "restore"]),
    organizationId: organizationIdSchema,
    expectedVersion: versionSchema,
    ...commandIdentity,
  }).strict(),
]);

export type OrganizationCommandActionInput = z.input<typeof organizationCommandInputSchema>;
export type OrganizationFilters = z.infer<typeof organizationFiltersSchema>;
export type OrganizationListItem = Readonly<{
  id: string;
  slug: string;
  name: string;
  status: "active" | "suspended" | "deleted";
  version: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type OrganizationListView = Readonly<{
  items: readonly OrganizationListItem[];
  nextCursor: string | null;
  filters: OrganizationFilters;
}>;
export type RoleOption = Readonly<{
  key: RoleKey;
  name: string;
  description: string;
  builtIn: boolean;
  permissionKeys: readonly string[];
}>;
export type ActiveUserOption = Readonly<{
  id: string;
  email: string;
  name: string;
}>;
export type MemberListItem = Readonly<{
  id: string;
  organizationId: string;
  userId: string;
  userLabel: string;
  roleKey: RoleKey;
  status: "active" | "suspended" | "deleted";
  version: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type MemberFilters = Readonly<{
  query?: string;
  includeDeleted: boolean;
  cursor: string | null;
  limit: number;
}>;
export type MemberListView = Readonly<{
  items: readonly MemberListItem[];
  nextCursor: string | null;
  filters: MemberFilters;
  roleOptions: readonly RoleOption[];
  userOptions: readonly ActiveUserOption[];
}>;
export type OrganizationEventView = Readonly<{
  id: string;
  kind: string;
  organizationId: string;
  requestId: string;
  commandId: string | null;
  createdAt: string;
}>;
export type OrganizationDetailView = Readonly<{
  organization: OrganizationListItem;
  members: MemberListView;
  roles: OrganizationRoleManagementView;
  events: readonly OrganizationEventView[];
}>;
