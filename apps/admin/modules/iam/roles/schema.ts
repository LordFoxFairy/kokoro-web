import { z } from "zod";

import { organizationIdSchema, roleKeySchema } from "../organizations/schema";

const versionSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const permissionKeySchema = z.string().regex(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/u).max(128);
const permissionKeysSchema = z.array(permissionKeySchema).max(512)
  .transform((values) => [...new Set(values)].sort());
const identity = {
  organizationId: organizationIdSchema,
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
};

export const organizationRoleCommandInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"), key: roleKeySchema, name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500), permissionKeys: permissionKeysSchema, ...identity,
  }).strict(),
  z.object({
    operation: z.literal("update"), roleId: z.string().uuid(), name: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500), expectedVersion: versionSchema, ...identity,
  }).strict(),
  z.object({
    operation: z.enum(["delete", "restore"]), roleId: z.string().uuid(), expectedVersion: versionSchema, ...identity,
  }).strict(),
  z.object({
    operation: z.literal("set-permissions"), roleId: z.string().uuid(), expectedVersion: versionSchema,
    permissionKeys: permissionKeysSchema, ...identity,
  }).strict(),
]);

export type OrganizationRoleCommandActionInput = z.input<typeof organizationRoleCommandInputSchema>;
export type OrganizationRoleItem = Readonly<{
  id: string;
  organizationId: string;
  key: string;
  name: string;
  description: string;
  builtIn: boolean;
  status: "active" | "deleted";
  version: string;
  permissionKeys: readonly string[];
}>;
export type OrganizationPermissionItem = Readonly<{
  key: string;
  action: string;
  description: string;
}>;
export type OrganizationPermissionGroup = Readonly<{
  resource: string;
  permissions: readonly OrganizationPermissionItem[];
}>;
export type OrganizationRoleManagementView = Readonly<{
  items: readonly OrganizationRoleItem[];
  permissionGroups: readonly OrganizationPermissionGroup[];
}>;
