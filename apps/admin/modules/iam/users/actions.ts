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
      ...(value.operation === "create" ? {} : { expectedVersion: value.expectedVersion }),
    });
    try {
      const client = await dependencies.loadClient();
      const result = await execute(client, value, command);
      if (value.operation === "create") {
        if (result.value.email !== value.email || result.value.platformRole !== "user") {
          throw new Error("invalid created user scope");
        }
      } else if (result.value.id !== value.userId || ((value.operation === "update") && result.value.email !== value.email)) {
        throw new Error("invalid user command scope");
      }
      dependencies.revalidatePath("/users");
      dependencies.revalidatePath(`/users/${result.value.id}`);
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

async function execute(
  client: IamManagementClient,
  value: ReturnType<typeof userCommandInputSchema.parse>,
  command: ReturnType<typeof parseCommandContext>,
) {
  switch (value.operation) {
    case "create":
      return client.createUser(command, value.email, value.name, normalizeImage(value.image));
    case "update":
      return client.updateUser(command, value.userId, value.email, value.name, normalizeImage(value.image));
    case "suspend":
      return client.suspendUser(command, value.userId);
    case "reactivate":
      return client.reactivateUser(command, value.userId);
    case "delete":
      return client.deleteUser(command, value.userId);
    case "restore":
      return client.restoreUser(command, value.userId);
  }
}

function normalizeImage(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
