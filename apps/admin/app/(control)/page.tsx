import { OverviewContent, type OverviewPresentationState } from "@/components/overview/overview-content";
import { requireIamActor } from "@/server/auth/session";

async function loadOverview(): Promise<OverviewPresentationState> {
  try {
    const actor = await requireIamActor();
    return {
      status: "ready",
      administrator: {
        email: actor.session.user.email,
        id: actor.session.user.id,
      },
      actorExpiresAt: actor.expiresAt.toISOString(),
    };
  } catch {
    return { status: "unavailable" };
  }
}

export default async function OverviewPage(): Promise<React.ReactElement> {
  const state = await loadOverview();
  return <OverviewContent state={state} />;
}
