import "server-only";

import { parseCommandContext } from "../../../server/commands/identity";
import { commandError, type CommandActionResult } from "../../../server/commands/result";
import { toIamWebError } from "../../../server/iam/error";
import type { IamManagementClient } from "../../../server/iam/management-client";
import { memberCommandInputSchema, type MemberCommandActionInput } from "./schema";
export type MemberActionHandlerDependencies = Readonly<{
  loadClient(): Promise<IamManagementClient>;
  revalidatePath(path: string): void;
}>;

export function createMemberActionHandler(dependencies: MemberActionHandlerDependencies) {
  return async function handle(input: MemberCommandActionInput): Promise<CommandActionResult> {
    const parsed = memberCommandInputSchema.safeParse(input);
    const commandId = parsed.success ? parsed.data.commandId : safeId(input, "commandId");
    const requestId = parsed.success ? parsed.data.requestId : safeId(input, "requestId");
    if (!parsed.success) return commandError(commandId, { kind: "invalid", requestId });

    const value = parsed.data;
    const command = parseCommandContext({
      requestId: value.requestId,
      commandId: value.commandId,
      reason: value.reason,
      ...(value.operation === "add" ? {} : { expectedVersion: value.expectedVersion }),
    });
    try {
      const client = await dependencies.loadClient();
      const result = await execute(client, value, command);
      if (
        result.value.organizationId !== value.organizationId
        || (value.operation === "add" ? result.value.userId !== value.userId : result.value.id !== value.memberId)
      ) {
        throw new Error("invalid member command scope");
      }
      dependencies.revalidatePath("/organizations");
      dependencies.revalidatePath(`/organizations/${value.organizationId}`);
      dependencies.revalidatePath("/access");
      return Object.freeze({ status: "success", commandId: value.commandId, replayed: result.replayed });
    } catch (error) {
      return commandError(value.commandId, toIamWebError(error));
    }
  };
}

async function execute(
  client: IamManagementClient,
  value: ReturnType<typeof memberCommandInputSchema.parse>,
  command: ReturnType<typeof parseCommandContext>,
) {
  switch (value.operation) {
    case "add":
      return client.addMember(command, value.organizationId, value.userId, value.roleKey);
    case "change-role":
      return client.changeMemberRole(command, value.organizationId, value.memberId, value.roleKey);
    case "suspend":
      return client.suspendMember(command, value.organizationId, value.memberId);
    case "reactivate":
      return client.reactivateMember(command, value.organizationId, value.memberId);
    case "remove":
      return client.removeMember(command, value.organizationId, value.memberId);
    case "restore":
      return client.restoreMember(command, value.organizationId, value.memberId);
  }
}

function safeId(input: unknown, key: string): string {
  if (typeof input !== "object" || input === null) return "";
  const value: unknown = Reflect.get(input, key);
  return typeof value === "string" ? value : "";
}
