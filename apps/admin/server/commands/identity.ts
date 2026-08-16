import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

const uuid = z.string().uuid();
const commandContextSchema = z.object({
  requestId: uuid,
  commandId: uuid,
  reason: z.string().trim().min(1).max(500),
  expectedVersion: z.string().regex(/^(?:0|[1-9][0-9]*)$/u).transform((value) => BigInt(value)).optional(),
}).strict();

export type CommandIdentity = Readonly<{ requestId: string; commandId: string }>;
export type WebCommandContext = Readonly<{
  requestId: string;
  commandId: string;
  reason: string;
  expectedVersion?: bigint;
}>;

export function createCommandIdentity(id: () => string = randomUUID): CommandIdentity {
  return Object.freeze({ requestId: id(), commandId: id() });
}

export function recoverCommandIdentity(identity: CommandIdentity, id: () => string = randomUUID): CommandIdentity {
  return Object.freeze({ requestId: id(), commandId: identity.commandId });
}

export function parseCommandContext(value: unknown): WebCommandContext {
  const result = commandContextSchema.safeParse(value);
  if (!result.success) throw new Error("invalid command context");
  return Object.freeze(result.data);
}
