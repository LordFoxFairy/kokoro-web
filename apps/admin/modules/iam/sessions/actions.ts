import "server-only";

import { z } from "zod";

import { parseCommandContext } from "../../../server/commands/identity";
import { commandError, type CommandActionResult } from "../../../server/commands/result";
import { toIamWebError } from "../../../server/iam/error";
import type { IamManagementClient } from "../../../server/iam/management-client";

const identity = {
  requestId: z.string().uuid(),
  commandId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
};
const sessionCommandInputSchema = z.discriminatedUnion("operation", [
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
export type SessionActionHandlerDependencies = Readonly<{
  loadClient(): Promise<IamManagementClient>;
  revalidatePath(path: string): void;
}>;

export function createSessionActionHandler(dependencies: SessionActionHandlerDependencies) {
  return async function handle(input: SessionCommandActionInput): Promise<CommandActionResult> {
    const parsed = sessionCommandInputSchema.safeParse(input);
    const commandId = parsed.success ? parsed.data.commandId : safeId(input, "commandId");
    const requestId = parsed.success ? parsed.data.requestId : safeId(input, "requestId");
    if (!parsed.success) return commandError(commandId, { kind: "invalid", requestId });
    const value = parsed.data;
    const command = parseCommandContext({
      requestId: value.requestId,
      commandId: value.commandId,
      reason: value.reason,
    });

    try {
      const client = await dependencies.loadClient();
      const result = value.operation === "revoke"
        ? await client.revokeSession(command, value.sessionId)
        : await client.revokeAllSessions(command, value.userId);
      dependencies.revalidatePath("/sessions");
      if (value.userId !== undefined) dependencies.revalidatePath(`/users/${value.userId}`);
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
