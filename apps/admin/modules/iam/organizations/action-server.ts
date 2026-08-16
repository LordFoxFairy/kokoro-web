"use server";

import { revalidatePath } from "next/cache";

import { requireIamActor } from "../../../server/auth/session";
import type { CommandActionResult } from "../../../server/commands/result";
import { createIamManagementClient } from "../../../server/iam/management-client";
import { createOrganizationActionHandler } from "./actions";
import type { OrganizationCommandActionInput } from "./schema";

const handle = createOrganizationActionHandler({
  async loadClient() {
    const actor = await requireIamActor();
    return createIamManagementClient(actor.transport);
  },
  revalidatePath,
});

export async function executeOrganizationAction(
  input: OrganizationCommandActionInput,
): Promise<CommandActionResult> {
  return handle(input);
}
