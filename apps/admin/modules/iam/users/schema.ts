import { z } from "zod";

export const userStatusSchema = z.enum(["all", "active", "suspended", "deleted"]);
export const userFiltersSchema = z.object({
  query: z.string().trim().max(320).default(""),
  status: userStatusSchema.default("all"),
  includeDeleted: z.boolean().default(false),
  cursor: z.string().max(512).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export type UserFilters = z.infer<typeof userFiltersSchema>;
export type UserListItem = Readonly<{
  id: string;
  email: string;
  name: string;
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

export const userCommandInputSchema = z.object({
  operation: z.enum(["suspend", "reactivate", "delete", "restore"]),
  userId: z.string().uuid(),
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
}).strict();

export type UserCommandActionInput = z.input<typeof userCommandInputSchema>;
