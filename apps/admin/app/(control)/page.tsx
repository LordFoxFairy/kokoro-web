import { IamOverview } from "@/modules/iam/overview/overview";
import { loadOverview } from "@/modules/iam/overview/query";
import type { OverviewState } from "@/modules/iam/overview/schema";
import { requireIamActor } from "@/server/auth/session";
import { toIamWebError } from "@/server/iam/error";
import { createIamManagementClient } from "@/server/iam/management-client";

async function loadPageState(): Promise<OverviewState> {
  try {
    const actor = await requireIamActor();
    return await loadOverview(createIamManagementClient(actor.transport), {
      administrator: {
        email: actor.session.user.email,
        id: actor.session.user.id,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("invalid ")) return { status: "malformed" };
    return { status: toIamWebError(error).kind === "internal" ? "malformed" : "unavailable" };
  }
}

export default async function OverviewPage(): Promise<React.ReactElement> {
  const state = await loadPageState();
  return <IamOverview state={state} />;
}
