import "server-only";

import { parseCommandContext } from "../../../server/commands/identity";
import { commandError, type CommandActionResult } from "../../../server/commands/result";
import { toIamWebError } from "../../../server/iam/error";
import type { IamManagementClient } from "../../../server/iam/management-client";
import { userCommandInputSchema, type UserCommandActionInput } from "./schema";

export type UserActionHandlerDependencies = Readonly<{
  loadClient(): Promise<IamManagementClient>;
  revalidatePath(path: string): void;
}>;

export function createUserActionHandler(dependencies: UserActionHandlerDependencies) {
  return async function handle(input: UserCommandActionInput): Promise<CommandActionResult> {
    const parsed = userCommandInputSchema.safeParse(input);
    const commandId = parsed.success ? parsed.data.commandId : safeId(input, "commandId");
    const requestId = parsed.success ? parsed.data.requestId : safeId(input, "requestId");
    if (!parsed.success) return commandError(commandId, { kind: "invalid", requestId });

    const value = parsed.data;
    const command = parseCommandContext({
      requestId: value.requestId,
      commandId: value.commandId,
      reason: value.reason,
      expectedVersion: value.expectedVersion,
    });
    try {
      const client = await dependencies.loadClient();
      const result = await execute(client, value.operation, command, value.userId);
      dependencies.revalidatePath("/users");
      dependencies.revalidatePath(`/users/${value.userId}`);
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

async function execute(
  client: IamManagementClient,
  operation: "suspend" | "reactivate" | "delete" | "restore",
  command: ReturnType<typeof parseCommandContext>,
  userId: string,
) {
  switch (operation) {
    case "suspend":
      return client.suspendUser(command, userId);
    case "reactivate":
      return client.reactivateUser(command, userId);
    case "delete":
      return client.deleteUser(command, userId);
    case "restore":
      return client.restoreUser(command, userId);
  }
}

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
