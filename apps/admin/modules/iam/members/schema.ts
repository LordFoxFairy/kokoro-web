import { z } from "zod";

import { organizationIdSchema, roleKeySchema } from "../organizations/schema";

const versionSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/u);
const identity = {
  organizationId: organizationIdSchema,
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
};

export const memberCommandInputSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("add"),
    userId: z.string().uuid(),
    roleKey: roleKeySchema,
    ...identity,
  }).strict(),
  z.object({
    operation: z.literal("change-role"),
    memberId: z.string().uuid(),
    roleKey: roleKeySchema,
    expectedVersion: versionSchema,
    ...identity,
  }).strict(),
  z.object({
    operation: z.enum(["suspend", "reactivate", "remove", "restore"]),
    memberId: z.string().uuid(),
    expectedVersion: versionSchema,
    ...identity,
  }).strict(),
]);

export type MemberCommandActionInput = z.input<typeof memberCommandInputSchema>;
