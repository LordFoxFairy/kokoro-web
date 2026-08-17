import "server-only";

import { parseCommandContext } from "../../../server/commands/identity";
import { commandError, type CommandActionResult } from "../../../server/commands/result";
import { toIamWebError } from "../../../server/iam/error";
import type { IamManagementClient } from "../../../server/iam/management-client";
import { siteRoleCommandInputSchema, type SiteRoleCommandActionInput } from "./schema";

export type SiteRoleActionHandlerDependencies = Readonly<{
  loadClient(): Promise<IamManagementClient>;
  revalidatePath(path: string): void;
}>;

export function createSiteRoleActionHandler(dependencies: SiteRoleActionHandlerDependencies) {
  return async function handle(input: SiteRoleCommandActionInput): Promise<CommandActionResult> {
    const parsed = siteRoleCommandInputSchema.safeParse(input);
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
        const roles = await client.listSiteRoles({ requestId: value.requestId, siteId: value.siteId, includeDeleted: true });
        if (roles.some((role) => role.siteId !== value.siteId)) throw new Error("invalid site role scope");
        const target = roles.find((role) => role.id === value.roleId);
        if (target === undefined) return commandError(value.commandId, { kind: "not_found", requestId: value.requestId });
        if (target.builtIn) return commandError(value.commandId, { kind: "forbidden", requestId: value.requestId });
      }
      const result = await execute(client, value, command);
      if (result.value.siteId !== value.siteId || result.value.builtIn
        || (value.operation === "create" ? result.value.key !== value.key : result.value.id !== value.roleId)
        || ((value.operation === "create" || value.operation === "set-permissions")
          && !sameKeys(result.value.permissionKeys, value.permissionKeys))) {
        throw new Error("invalid site role command scope");
      }
      dependencies.revalidatePath(`/sites/${value.siteId}`);
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

async function execute(client: IamManagementClient, value: ReturnType<typeof siteRoleCommandInputSchema.parse>, command: ReturnType<typeof parseCommandContext>) {
  switch (value.operation) {
    case "create": return client.createSiteRole(command, value.siteId, value.key, value.name, value.description, value.permissionKeys);
    case "update": return client.updateSiteRole(command, value.siteId, value.roleId, value.name, value.description);
    case "delete": return client.deleteSiteRole(command, value.siteId, value.roleId);
    case "restore": return client.restoreSiteRole(command, value.siteId, value.roleId);
    case "set-permissions": return client.setSiteRolePermissions(command, value.siteId, value.roleId, value.permissionKeys);
  }
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  const normalized = [...new Set(left)].sort();
  return normalized.length === right.length && normalized.every((key, index) => key === right[index]);
}

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
