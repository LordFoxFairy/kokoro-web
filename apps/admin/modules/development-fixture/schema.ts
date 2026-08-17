import { z } from "zod";

const base = z.object({
  requestId: z.string().uuid(),
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(128),
}).strict();

export const developmentFixtureInputSchema = z.discriminatedUnion("operation", [
  base.extend({ operation: z.literal("bootstrap"), userId: z.string().uuid(), name: z.string().trim().min(1).max(160) }).strict(),
  base.extend({ operation: z.literal("reset") }).strict(),
]);

export type DevelopmentFixtureInput = z.input<typeof developmentFixtureInputSchema>;
export type DevelopmentFixtureResult =
  | Readonly<{ status: "success"; operation: "bootstrap" | "reset"; email: string; outcome: "CREATED" | "EXISTS" | "RESET" }>
  | Readonly<{ status: "error"; operation: "bootstrap" | "reset"; kind: "disabled" | "invalid" | "unavailable" }>;
