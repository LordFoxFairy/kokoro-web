"use server";

import { revalidatePath } from "next/cache";

import { requireIamActor } from "../../../server/auth/session";
import type { CommandActionResult } from "../../../server/commands/result";
import { createIamManagementClient } from "../../../server/iam/management-client";
import { createOrganizationRoleActionHandler } from "./actions";
import type { OrganizationRoleCommandActionInput } from "./schema";

const handle = createOrganizationRoleActionHandler({
  async loadClient() {
    const actor = await requireIamActor();
    return createIamManagementClient(actor.transport);
  },
  revalidatePath,
});

export async function executeOrganizationRoleAction(
  input: OrganizationRoleCommandActionInput,
): Promise<CommandActionResult> {
  return handle(input);
}
