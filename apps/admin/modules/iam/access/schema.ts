import { z } from "zod";

import type { IamAuthorizationReason, IamRoleKey } from "@/lib/iam-values";

export const accessFiltersSchema = z.object({
  organizationId: z.string().uuid().nullable().default(null),
  organizationQuery: z.string().trim().max(160).default(""),
  organizationCursor: z.string().max(512).nullable().default(null),
  organizationLimit: z.number().int().min(1).max(100).default(25),
  userId: z.string().uuid().nullable().default(null),
  userQuery: z.string().trim().max(254).default(""),
  permissionKey: z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/u).max(128).nullable().default(null),
  resourceRef: z.string().trim().max(320).nullable().default(null),
}).strict();

export type AccessFilters = z.infer<typeof accessFiltersSchema>;
export type AccessOrganization = Readonly<{ id: string; slug: string; name: string }>;
export type AccessUser = Readonly<{ id: string; email: string; name: string }>;
export type AccessRole = Readonly<{
  key: IamRoleKey;
  name: string;
  description: string;
  builtIn: boolean;
  status: "active" | "deleted";
  permissionKeys: readonly string[];
}>;
export type AccessPermission = Readonly<{
  key: string;
  resource: string;
  action: string;
  description: string;
  status: "active" | "retired";
}>;
export type AccessDecision = Readonly<{
  allowed: boolean;
  reasonCode: IamAuthorizationReason;
  userId: string;
  organizationId: string;
  roleKeys: readonly IamRoleKey[];
  authorizationVersion: string;
  evaluatedAt: string;
}>;
export type AccessView = Readonly<{
  organizations: readonly AccessOrganization[];
  nextOrganizationCursor: string | null;
  users: readonly AccessUser[];
  roles: readonly AccessRole[];
  permissions: readonly AccessPermission[];
  filters: AccessFilters;
  decision: AccessDecision | null;
}>;
