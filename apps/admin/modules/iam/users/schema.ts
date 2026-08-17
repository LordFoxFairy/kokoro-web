import { z } from "zod";

export const userStatusSchema = z.enum(["all", "active", "suspended", "deleted"]);
export const userPlatformRoleSchema = z.enum(["all", "user", "admin"]);
export const userEmailSchema = z.string().trim().email().max(320);
export const userNameSchema = z.string().trim().min(1).max(160);
export const userImageSchema = z.union([z.string().trim().url().max(2048), z.literal("")]);
export const userFiltersSchema = z.object({
  query: z.string().trim().max(320).default(""),
  status: userStatusSchema.default("all"),
  platformRole: userPlatformRoleSchema.default("all"),
  includeDeleted: z.boolean().default(false),
  cursor: z.string().max(512).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export type UserFilters = z.infer<typeof userFiltersSchema>;
export type UserListItem = Readonly<{
  id: string;
  email: string;
  name: string;
  image?: string | null;
  platformRole: "user" | "admin";
  status: "active" | "suspended" | "deleted";
  version: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type UserListView = Readonly<{
  items: readonly UserListItem[];
  nextCursor: string | null;
  filters: UserFilters;
}>;
export type UserEventView = Readonly<{
  id: string;
  kind: string;
  requestId: string;
  commandId: string | null;
  createdAt: string;
}>;
export type UserDetailView = Readonly<{
  user: UserListItem;
  sessions: import("../sessions/schema").SessionListView;
  events: readonly UserEventView[];
}>;

const commandIdentity = {
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
};
const userIdSchema = z.string().uuid();
const versionSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);

export const userCommandInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    email: userEmailSchema,
    name: userNameSchema,
    image: userImageSchema.optional(),
    ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.literal("update"),
    userId: userIdSchema,
    email: userEmailSchema,
    name: userNameSchema,
    image: userImageSchema.optional(),
    expectedVersion: versionSchema,
    ...commandIdentity,
  }).strict(),
  z.object({
    operation: z.enum(["suspend", "reactivate", "delete", "restore"]),
    userId: userIdSchema,
    ...commandIdentity,
    expectedVersion: versionSchema,
  }).strict(),
]);

export type UserCommandActionInput = z.input<typeof userCommandInputSchema>;
