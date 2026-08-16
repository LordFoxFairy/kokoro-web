import "server-only";

import { parseCommandContext } from "../../../server/commands/identity";
import { commandError, type CommandActionResult } from "../../../server/commands/result";
import { toIamWebError } from "../../../server/iam/error";
import type { IamManagementClient } from "../../../server/iam/management-client";
import { organizationCommandInputSchema, type OrganizationCommandActionInput } from "./schema";

export type OrganizationActionHandlerDependencies = Readonly<{
  loadClient(): Promise<IamManagementClient>;
  revalidatePath(path: string): void;
}>;

export function createOrganizationActionHandler(dependencies: OrganizationActionHandlerDependencies) {
  return async function handle(input: OrganizationCommandActionInput): Promise<CommandActionResult> {
    const parsed = organizationCommandInputSchema.safeParse(input);
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
      if (
        value.operation === "create"
          ? result.value.slug !== value.slug
          : result.value.id !== value.organizationId
      ) {
        throw new Error("invalid organization command scope");
      }
      dependencies.revalidatePath("/organizations");
      dependencies.revalidatePath(`/organizations/${result.value.id}`);
      dependencies.revalidatePath("/access");
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

async function execute(
  client: IamManagementClient,
  value: zOutput,
  command: ReturnType<typeof parseCommandContext>,
) {
  switch (value.operation) {
    case "create":
      return client.createOrganization(command, value.slug, value.name);
    case "update":
      return client.updateOrganization(command, value.organizationId, value.name);
    case "delete":
      return client.deleteOrganization(command, value.organizationId);
    case "restore":
      return client.restoreOrganization(command, value.organizationId);
  }
}

type zOutput = ReturnType<typeof organizationCommandInputSchema.parse>;

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
