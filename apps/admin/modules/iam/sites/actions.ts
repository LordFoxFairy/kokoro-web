import "server-only";

import { parseCommandContext } from "../../../server/commands/identity";
import { commandError, type CommandActionResult } from "../../../server/commands/result";
import { toIamWebError } from "../../../server/iam/error";
import type { IamManagementClient } from "../../../server/iam/management-client";
import { siteCommandInputSchema, type SiteCommandActionInput } from "./schema";

export type SiteActionHandlerDependencies = Readonly<{
  loadClient(): Promise<IamManagementClient>;
  revalidatePath(path: string): void;
}>;

export function createSiteActionHandler(dependencies: SiteActionHandlerDependencies) {
  return async function handle(input: SiteCommandActionInput): Promise<CommandActionResult> {
    const parsed = siteCommandInputSchema.safeParse(input);
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
      const result = await execute(client, value, command);
      const targetSiteId = "siteId" in value ? value.siteId : result.value.id;
      const memberOperation = value.operation === "add-member" || "memberId" in value;
      if ((memberOperation && !("siteId" in result.value))
        || ("siteId" in result.value && result.value.siteId !== targetSiteId)
        || ("memberId" in value && result.value.id !== value.memberId)
        || (!memberOperation && result.value.id !== targetSiteId)
        || (value.operation === "add-member" && (!("userId" in result.value) || result.value.userId !== value.userId))
        || ("owner" in result && result.owner.siteId !== targetSiteId)
        || (value.operation === "create" && (!("code" in result.value) || result.value.code !== value.code))) {
        throw new Error("invalid site command scope");
      }
      revalidate(dependencies.revalidatePath, targetSiteId, value.operation);
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

async function execute(
  client: IamManagementClient,
  value: ReturnType<typeof siteCommandInputSchema.parse>,
  command: ReturnType<typeof parseCommandContext>,
) {
  switch (value.operation) {
    case "create": return client.createSite(command, value.code, value.name);
    case "update": return client.updateSite(command, value.siteId, value.name);
    case "suspend": return client.suspendSite(command, value.siteId);
    case "reactivate": return client.reactivateSite(command, value.siteId);
    case "delete": return client.deleteSite(command, value.siteId);
    case "restore": return client.restoreSite(command, value.siteId);
    case "add-member": return client.addSiteMember(command, value.siteId, value.userId, value.roleKey);
    case "change-member-role": return client.changeSiteMemberRole(command, value.siteId, value.memberId, value.roleKey);
    case "suspend-member": return client.suspendSiteMember(command, value.siteId, value.memberId);
    case "reactivate-member": return client.reactivateSiteMember(command, value.siteId, value.memberId);
    case "remove-member": return client.removeSiteMember(command, value.siteId, value.memberId);
    case "restore-member": return client.restoreSiteMember(command, value.siteId, value.memberId);
    case "select": return Object.freeze({ value: await client.selectSite(command, value.siteId), replayed: false });
  }
}

function revalidate(path: (value: string) => void, siteId: string, operation: string): void {
  if (["create", "update", "suspend", "reactivate", "delete", "restore"].includes(operation)) path("/sites");
  path(`/sites/${siteId}`);
  path("/audit");
  if (operation === "select") path("/sessions");
}

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
