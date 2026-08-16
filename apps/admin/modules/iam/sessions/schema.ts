import { z } from "zod";

export const sessionFiltersSchema = z.object({
  userId: z.string().uuid().nullable().default(null),
  cursor: z.string().max(512).nullable().default(null),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export type SessionFilters = z.infer<typeof sessionFiltersSchema>;
export type SessionListItem = Readonly<{
  id: string;
  userId: string;
  status: "active" | "revoked" | "expired";
  activeOrganizationId: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}>;
export type SessionListView = Readonly<{
  items: readonly SessionListItem[];
  nextCursor: string | null;
  filters: SessionFilters;
}>;

const identity = {
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
};

export const sessionCommandInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("revoke"),
    sessionId: z.string().uuid(),
    userId: z.string().uuid().optional(),
    ...identity,
  }).strict(),
  z.object({
    operation: z.literal("revoke-all"),
    userId: z.string().uuid(),
    ...identity,
  }).strict(),
]);

export type SessionCommandActionInput = z.input<typeof sessionCommandInputSchema>;
