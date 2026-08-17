import "server-only";

import { parseCommandContext } from "../../../server/commands/identity";
import { commandError, type CommandActionResult } from "../../../server/commands/result";
import { toIamWebError } from "../../../server/iam/error";
import type { IamManagementClient } from "../../../server/iam/management-client";
import { organizationRoleCommandInputSchema, type OrganizationRoleCommandActionInput } from "./schema";

export type OrganizationRoleActionHandlerDependencies = Readonly<{
  loadClient(): Promise<IamManagementClient>;
  revalidatePath(path: string): void;
}>;

export function createOrganizationRoleActionHandler(dependencies: OrganizationRoleActionHandlerDependencies) {
  return async function handle(input: OrganizationRoleCommandActionInput): Promise<CommandActionResult> {
    const parsed = organizationRoleCommandInputSchema.safeParse(input);
    const commandId = parsed.success ? parsed.data.commandId : safeId(input, "commandId");
    const requestId = parsed.success ? parsed.data.requestId : safeId(input, "requestId");
    if (!parsed.success) return commandError(commandId, { kind: "invalid", requestId });
    const value = parsed.data;
    const command = parseCommandContext({
      requestId: value.requestId, commandId: value.commandId, reason: value.reason,
      ...("expectedVersion" in value ? { expectedVersion: value.expectedVersion } : {}),
    });
    try {
      const client = await dependencies.loadClient();
      if (value.operation !== "create") {
        const roles = await client.listOrganizationRoles({
          requestId: value.requestId, organizationId: value.organizationId, includeDeleted: true,
        });
        const target = roles.find((role) => role.id === value.roleId);
        if (target === undefined) return commandError(value.commandId, { kind: "not_found", requestId: value.requestId });
        if (target.builtIn) return commandError(value.commandId, { kind: "forbidden", requestId: value.requestId });
      }
      const result = await execute(client, value, command);
      if (result.value.organizationId !== value.organizationId
        || result.value.builtIn
        || (value.operation === "create" ? result.value.key !== value.key : result.value.id !== value.roleId)
        || ((value.operation === "create" || value.operation === "set-permissions")
          && !sameKeys(result.value.permissionKeys, value.permissionKeys))) {
        throw new Error("invalid organization role command scope");
      }
      dependencies.revalidatePath(`/organizations/${value.organizationId}`);
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

async function execute(
  client: IamManagementClient,
  value: ReturnType<typeof organizationRoleCommandInputSchema.parse>,
  command: ReturnType<typeof parseCommandContext>,
) {
  switch (value.operation) {
    case "create": return client.createOrganizationRole(command, value.organizationId, value.key, value.name, value.description, value.permissionKeys);
    case "update": return client.updateOrganizationRole(command, value.organizationId, value.roleId, value.name, value.description);
    case "delete": return client.deleteOrganizationRole(command, value.organizationId, value.roleId);
    case "restore": return client.restoreOrganizationRole(command, value.organizationId, value.roleId);
    case "set-permissions": return client.setOrganizationRolePermissions(command, value.organizationId, value.roleId, value.permissionKeys);
  }
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  const normalizedLeft = [...new Set(left)].sort();
  return normalizedLeft.length === right.length && normalizedLeft.every((key, index) => key === right[index]);
}

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
