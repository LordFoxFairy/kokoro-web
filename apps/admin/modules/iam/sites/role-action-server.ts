"use server";

import { revalidatePath } from "next/cache";

import { requireIamActor } from "../../../server/auth/session";
import type { CommandActionResult } from "../../../server/commands/result";
import { createIamManagementClient } from "../../../server/iam/management-client";
import { createSiteRoleActionHandler } from "./role-actions";
import type { SiteRoleCommandActionInput } from "./schema";

const handle = createSiteRoleActionHandler({
  async loadClient() {
    const actor = await requireIamActor();
    return createIamManagementClient(actor.transport);
  },
  revalidatePath,
});

export async function executeSiteRoleAction(input: SiteRoleCommandActionInput): Promise<CommandActionResult> {
  return handle(input);
}
