"use server";

import { revalidatePath } from "next/cache";

import { requireIamActor } from "../../../server/auth/session";
import type { CommandActionResult } from "../../../server/commands/result";
import { createIamManagementClient } from "../../../server/iam/management-client";
import { createMemberActionHandler } from "./actions";
import type { MemberCommandActionInput } from "./schema";

const handle = createMemberActionHandler({
  async loadClient() {
    const actor = await requireIamActor();
    return createIamManagementClient(actor.transport);
  },
  revalidatePath,
});

export async function executeMemberAction(input: MemberCommandActionInput): Promise<CommandActionResult> {
  return handle(input);
}
