"use server";

import { revalidatePath } from "next/cache";

import { requireIamActor } from "../../../server/auth/session";
import type { CommandActionResult } from "../../../server/commands/result";
import { createIamManagementClient } from "../../../server/iam/management-client";
import { createSiteActionHandler } from "./actions";
import type { SiteCommandActionInput } from "./schema";

const handle = createSiteActionHandler({
  async loadClient() {
    const actor = await requireIamActor();
    return createIamManagementClient(actor.transport);
  },
  revalidatePath,
});

export async function executeSiteAction(input: SiteCommandActionInput): Promise<CommandActionResult> {
  return handle(input);
}
