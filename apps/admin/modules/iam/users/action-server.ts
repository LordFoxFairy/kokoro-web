"use server";

import { revalidatePath } from "next/cache";

import { requireIamActor } from "../../../server/auth/session";
import type { CommandActionResult } from "../../../server/commands/result";
import { createIamManagementClient } from "../../../server/iam/management-client";
import { createUserActionHandler } from "./actions";
import type { UserCommandActionInput } from "./schema";

const handle = createUserActionHandler({
  async loadClient() {
    const actor = await requireIamActor();
    return createIamManagementClient(actor.transport);
  },
  revalidatePath,
});

export async function executeUserAction(input: UserCommandActionInput): Promise<CommandActionResult> {
  return handle(input);
}
